from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from scipy.io import savemat

from lstm_pipeline import (ArousalLSTM, N_INPUTS, SEQUENCE_LENGTH, StreamingScorer,
                           build_inputs, run)

CHANNELS = ['AF3', 'F7', 'F3', 'FC5', 'T7', 'P7', 'O1',
            'O2', 'P8', 'T8', 'FC6', 'F4', 'F8', 'AF4']
MODEL = Path.home() / 'Downloads' / 'arousal_lstm_muse.keras'
TRIAL_SAMPLES = SEQUENCE_LENGTH + 3 * 256 + 100  # 4 windows at 128 Hz, plus a partial hop


def fake_inputs(window, fs):
    """Placeholder only: NOT the model's real input recipe."""
    return np.resize(window.to_numpy(), (SEQUENCE_LENGTH, N_INPUTS))


class FakeModel:
    sha256 = 'fake'

    def __init__(self):
        self.calls = []

    def predict(self, inputs):
        assert inputs.shape == (SEQUENCE_LENGTH, N_INPUTS)
        self.calls.append(inputs)
        return 0.5


@pytest.fixture
def dataset(tmp_path):
    rng = np.random.default_rng(0)
    subjects = np.empty(2, dtype=object)
    for subject in range(2):
        trials = np.empty(2, dtype=object)
        trials[0] = rng.normal(size=(TRIAL_SAMPLES, 14))
        trials[1] = rng.normal(size=(SEQUENCE_LENGTH - 1, 14))  # too short to score
        subjects[subject] = {'EEG': {'stimuli': trials}, 'ScoreArousal': [2, 4]}
    path = tmp_path / 'DREAMER.mat'
    savemat(path, {'DREAMER': {'Data': subjects, 'EEG_Electrodes': np.array(CHANNELS, dtype=object),
                              'EEG_SamplingRate': 128}})
    return path


def test_scores_every_two_seconds_after_buffer_fills():
    model = FakeModel()
    scorer = StreamingScorer(model, CHANNELS, 128.0, fake_inputs)
    samples = np.arange(TRIAL_SAMPLES * 14, dtype=float).reshape(TRIAL_SAMPLES, 14)
    results = scorer.push(samples[:SEQUENCE_LENGTH - 1])
    assert results == []
    results += scorer.push(samples[SEQUENCE_LENGTH - 1:])
    assert [r['end_sample'] for r in results] == [2500, 2756, 3012, 3268]
    assert [r['start_sample'] for r in results] == [0, 256, 512, 768]
    # Each scored window is the latest SEQUENCE_LENGTH samples
    assert np.array_equal(model.calls[1], fake_inputs(pd.DataFrame(samples[256:2756]), 128.0))


def test_run_all_subjects_and_trials(dataset, tmp_path):
    manifest = run(dataset, 'unused.keras', tmp_path / 'out', input_builder=fake_inputs, model=FakeModel())
    rows = pd.read_csv(tmp_path / 'out' / 'windows.csv')
    coverage = pd.read_csv(tmp_path / 'out' / 'coverage.csv')
    assert manifest['status'] == 'complete'
    assert manifest['sequence_seconds'] == pytest.approx(19.53125)
    assert len(rows) == 8
    assert rows.groupby('participant_id').size().tolist() == [4, 4]
    assert rows.arousal_trial_label.unique().tolist() == [2]
    assert coverage.processed_windows.tolist() == [4, 0, 4, 0]
    with pytest.raises(FileExistsError):
        run(dataset, 'unused.keras', tmp_path / 'out', input_builder=fake_inputs, model=FakeModel())


def test_limit_is_explicit(dataset, tmp_path):
    manifest = run(dataset, 'unused.keras', tmp_path / 'limited', max_windows=1,
                   input_builder=fake_inputs, model=FakeModel())
    assert manifest['status'] == 'limited'
    assert manifest['processed_windows'] == 1


def test_unknown_mapping_fails_loudly(dataset, tmp_path):
    with pytest.raises(ValueError, match='36 inputs is unknown'):
        run(dataset, 'unused.keras', tmp_path / 'unmapped', model=FakeModel())
    with pytest.raises(NotImplementedError):
        build_inputs(pd.DataFrame(np.zeros((SEQUENCE_LENGTH, 14)), columns=CHANNELS), 128.0)


@pytest.mark.skipif(not MODEL.exists(), reason='arousal_lstm_muse.keras not in Downloads')
def test_real_model_loads_and_scores_within_budget():
    model = ArousalLSTM(MODEL)
    model.predict(np.zeros((SEQUENCE_LENGTH, N_INPUTS)))  # first call traces the graph
    scorer = StreamingScorer(model, CHANNELS, 128.0, fake_inputs)
    results = scorer.push(np.random.default_rng(1).normal(size=(SEQUENCE_LENGTH + 256, 14)))
    assert len(results) == 2
    assert all(0 <= r['probability'] <= 1 for r in results)
    assert not any(r['exceeds_2s_budget'] for r in results)
    with pytest.raises(ValueError):
        model.predict(np.zeros((SEQUENCE_LENGTH, 14)))


def test_try_model_loads_and_windows_inputs(tmp_path):
    from try_model import load_inputs, score
    values = np.random.default_rng(2).normal(size=(SEQUENCE_LENGTH + 300, N_INPUTS))
    pd.DataFrame(values).to_csv(tmp_path / 'inputs.csv', index=False)
    np.save(tmp_path / 'inputs.npy', values)
    assert np.allclose(load_inputs(tmp_path / 'inputs.csv'), values)
    assert np.array_equal(load_inputs(tmp_path / 'inputs.npy'), values)
    rows = list(score(FakeModel(), values, 256))
    assert [r['start_row'] for r in rows] == [0, 256]
    np.save(tmp_path / 'wrong.npy', values[:, :14])
    with pytest.raises(ValueError, match='36 inputs'):
        load_inputs(tmp_path / 'wrong.npy')
