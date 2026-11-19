/**
 * Turns off zod's just-in-time compiler. Its first parse probes `new Function("")`, which a strict
 * Content-Security-Policy (no 'unsafe-eval', see `proxy.ts`) blocks: the throw is caught, but Firefox
 * still reports the blocked probe as a console error on every page. The interpreted path validates the
 * same way and is fast enough for forms.
 */
import { z } from "zod";

z.config({ jitless: true });
