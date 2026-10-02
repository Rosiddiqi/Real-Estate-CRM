// Entry. On a phone (or inside the native app) the app boots right here. On a
// wide desktop window it boots inside a phone-width frame instead — KeyMatch
// is an iPhone app first, and a stretched 2,000px layout helps nobody.
import { shouldFrame, mountDesktopFrame } from './lib/desktopFrame';

if (shouldFrame()) mountDesktopFrame();
else import('./boot').then((m) => m.boot());
