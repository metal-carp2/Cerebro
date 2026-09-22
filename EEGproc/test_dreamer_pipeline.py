import json
import zipfile
import sys
from types import SimpleNamespace
from importlib.metadata import version

import numpy as np
import pandas as pd
import pytest
from scipy.io import savemat

from dreamer_pipeline import run, trial_matrix, keras_metadata, RegressionPredictor, sha256, PIPELINE

CHANNELS = ['AF3', 'F7', 'F3', 'FC5', 'T7', 'P7', 'O1',
            'O2', 'P8', 'T8', 'FC6', 'F4', 'F8', 'AF4']


@pytest.fixture
def dataset(tmp_path):
    rng = np.random.default_rng(42)
    subjects = np.empty(2, dtype=object)
    for subject in range(2):
        trials = np.empty(2, dtype=object)
        for trial in range(2):
            trials[trial] = rng.normal(size=(519, 14))
        subjects[subject] = {'EEG': {'stimuli': trials}, 'ScoreArousal': [2, 4]}
    path = tmp_path / 'DREAMER.mat'
    savemat(path, {'DREAMER': {'Data': subjects, 'EEG_Electrodes': np.array(CHANNELS, dtype=object),
                              'EEG_SamplingRate': 128}})
    return path


def test_all_subjects_trials_and_windows(dataset, tmp_path):
    output = tmp_path / 'all'
    manifest = run(dataset, output, 'uV')
    rows = pd.read_csv(output / 'windows.csv')
    coverage = pd.read_csv(output / 'coverage.csv')
    assert manifest['status'] == 'complete'
    assert len(rows) == 8
    assert len(manifest['feature_order']) == 210
    assert len(coverage) == 4
    assert coverage.dropped_tail_samples.tolist() == [7] * 4
    assert rows.groupby(['participant_id', 'trial_id']).size().tolist() == [2] * 4
    assert rows.start_sample.tolist() == [0, 256] * 4
    assert rows.arousal_trial_label.tolist() == [2, 2, 4, 4] * 2
    assert rows.prediction.isna().all()
    assert np.isfinite(rows[manifest['feature_order']]).all().all()
    with pytest.raises(FileExistsError):
        run(dataset, output, 'uV')


def test_limit_is_explicit(dataset, tmp_path):
    manifest = run(dataset, tmp_path / 'limited', 'uV', max_windows=1)
    assert manifest['status'] == 'limited'
    assert manifest['processed_windows'] == 1


def test_channel_orientation_and_invalid_data():
    assert trial_matrix(np.ones((14, 256)), CHANNELS).shape == (256, 14)
    with pytest.raises(ValueError):
        trial_matrix(np.full((256, 14), np.nan), CHANNELS)


def test_safe_archive_inspection(tmp_path):
    path = tmp_path / 'model.keras'
    config = {'config': {'layers': [
        {'class_name': 'InputLayer', 'config': {'batch_shape': [None, 2500, 36]}},
        {'class_name': 'Dense', 'config': {'activation': 'sigmoid'}}]},
        'compile_config': {'loss': 'binary_crossentropy'}}
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('config.json', json.dumps(config))
    assert keras_metadata(path)['input_shapes'] == [[None, 2500, 36]]
    assert keras_metadata(path)['loss'] == 'binary_crossentropy'


def test_regression_contract_scaling_and_order(tmp_path, monkeypatch):
    model_path = tmp_path / 'regressor.keras'
    with zipfile.ZipFile(model_path, 'w') as archive:
        archive.writestr('config.json', json.dumps({'compile_config': {'loss': 'mse'}}))
    class FakeModel:
        input_shape = (None, 2)
        output_shape = (None, 1)

        def __call__(self, values, training=False):
            np.testing.assert_allclose(values, [[2, 3]])
            return np.array([[0.5]])

    monkeypatch.setitem(sys.modules, 'tensorflow', SimpleNamespace(keras=SimpleNamespace(
        models=SimpleNamespace(load_model=lambda *a, **kw: FakeModel()))))
    contract = {'task': 'arousal_regression', 'pipeline': PIPELINE, 'window_seconds': 2,
                'sample_rate': 128, 'input_units': 'uV', 'eegproc_version': version('eegproc'),
                'model_sha256': sha256(model_path), 'feature_order': ['b', 'a'],
                'scaling': {'kind': 'standard', 'mean': [1, 2], 'scale': [2, 3]},
                'output_scale': 4, 'output_offset': 1, 'output_units': 'rating'}
    contract_path = tmp_path / 'contract.json'
    contract_path.write_text(json.dumps(contract))
    predictor = RegressionPredictor(model_path, contract_path, 128, 'uV')
    assert predictor.predict(pd.DataFrame({'a': [11], 'b': [5]})) == 3
    with pytest.raises(ValueError, match='unavailable'):
        predictor.predict(pd.DataFrame({'a': [11]}))
    with pytest.raises(ValueError, match='contract'):
        RegressionPredictor(model_path, contract_path, 256, 'uV')
    with zipfile.ZipFile(model_path, 'w') as archive:
        archive.writestr('config.json', json.dumps({'compile_config': {'loss': 'binary_crossentropy'}}))
    contract['model_sha256'] = sha256(model_path)
    contract_path.write_text(json.dumps(contract))
    with pytest.raises(ValueError, match='classification loss'):
        RegressionPredictor(model_path, contract_path, 128, 'uV')
