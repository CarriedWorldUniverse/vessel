# Vessel iOS

Native SwiftUI companion client for Vessel.

This directory is a source scaffold for the first iPhone build. A verified Xcode project is not committed yet because this machine currently has Command Line Tools selected instead of full Xcode:

```bash
xcodebuild -version
# xcode-select: active developer directory is a command line tools instance
```

Once Xcode is installed/selected:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Create an iOS SwiftUI app project around the files in `Vessel/`, enable automatic signing with the operator's Apple Developer team, and set the bundle identifier to:

```text
universe.carriedworld.vessel
```

Required `Info.plist` usage strings:

- `NSMicrophoneUsageDescription`
- `NSSpeechRecognitionUsageDescription`

See `../docs/2026-06-09-vessel-ios-mvp-spec.md` for the MVP scope.
