# iPhone builds from Windows

Prerequisites: an Expo account, active Apple Developer Program membership, and a physical iPhone registered for internal distribution. No Mac is required for EAS cloud builds. The iOS bundle identifier is `com.metalcarp2.cerebro`; change it before registering if your Apple team requires another identifier.

Run these commands in `neuroflow-studio`:

```powershell
npm install
npx eas-cli login
npx eas-cli init
npx eas-cli device:create
npm run build:ios
```

Sign in through the CLI prompts yourself. Open the device registration URL on the iPhone and follow its instructions. The build command prompts for Apple signing and provisioning. Select the registered iPhone. Do not paste credentials in chat or commit them. Cloud build availability depends on your EAS plan and the SDK's available build images.

After a successful build, open the installation URL on your iPhone, install the app, and enable Settings > Privacy & Security > Developer Mode if prompted. Then on Windows:

```powershell
npm run start:ios
```

Keep the iPhone and PC on the same Wi-Fi, allow Node through the private-network firewall, and open the QR link in the installed development app. This is a custom development build, not Expo Go. The app currently appears as NeuroFlow Studio. Native dependency or app configuration changes require rebuilding; JavaScript edits reload from the development server.

For standalone testing and latency measurements, use `npm run build:ios:preview`. This produces an internal release build with bundled JavaScript that does not need the PC's development server. Register devices before building. Use release builds for reported timing results; development overhead is not representative. Neither profile submits to the App Store.

Conda is used for the Python data converter only; it does not run Python on the iPhone. The arousal model and Vitor's preprocessing adapter are still pending. iOS compilation and physical-device behavior must be checked after Apple signing is configured.
