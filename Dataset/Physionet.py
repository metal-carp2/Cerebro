import os
from pathlib import Path
import mne 
import glob


file_path = Path(r"C:\Users\vasub\Downloads\eegmmidb-1.0.0\files")


if file_path.exists():
    print(f"The path {file_path} exists")
else:
    print(f"The path does not exist")


files = sorted(file_path.rglob("*.edf"))


for file in files:
    #if file.parent.name == "S001":
    #    print("Change")

    print(f"Subject {file.parent.name}: {file.name}")

print(f"Total number of files in the directory: {len(files)}")





def read_data(file_path):

    data = mne. io.read_raw_edf(file_path, preload=True)
    data.set_eeg_reference()
    data.filter(l_freq=1.0, h_freq=40.0)
    epochs = mne.make_fixed_length_epochs(data, duration=2.0, preload=True)
    array = epochs.get_data()
    return array

sample_data = read_data(files[0])

#60 second time intervals since 30 epochs and 2 seconds per epoch

print(sample_data.shape) #  (#Epochs, #Channels, #Length of signal)



