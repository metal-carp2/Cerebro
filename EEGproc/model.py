import os
import tensorflow as tf

model_path = os.path.expanduser('~/Downloads/arousal_lstm_muse.keras')
if not os.path.exists(model_path):
	raise FileNotFoundError(f"Model file not found: {model_path}")

arousal_model = tf.keras.models.load_model(model_path)
print(arousal_model.summary())