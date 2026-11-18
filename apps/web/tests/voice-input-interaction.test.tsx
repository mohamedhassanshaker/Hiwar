// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVoiceInput, withSpoken } from "@/hooks/use-voice-input";
import { cleanup, mount } from "./dom";

/**
 * D386: the recorder behind every microphone button. The browser's microphone and recorder are
 * faked — they are the external system here — and the hook is driven as a button drives it.
 */

afterEach(cleanup);

/** A recorder that hands back one chunk of audio when it is stopped, as a browser does. */
class FakeRecorder {
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  track.stop.mockReset();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

/** A microphone button over the hook, showing its state. */
function Mic(props: { transcribe: (audio: Blob) => Promise<string>; onText: (text: string) => void; onProblem: (message: string) => void }) {
  const { state, toggle } = useVoiceInput({ ...props, t: (en) => en });
  return (
    <button type="button" data-state={state} onClick={toggle}>
      mic
    </button>
  );
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe("useVoiceInput", () => {
  it("should_record_then_send_the_recording_and_hand_back_its_text", async () => {
    const transcribe = vi.fn(async () => "renew my permit");
    const onText = vi.fn();
    const { container } = await mount(<Mic transcribe={transcribe} onText={onText} onProblem={() => {}} />);
    const button = container.querySelector("button")!;

    await act(async () => button.click());
    expect(button.dataset.state).toBe("recording");

    await act(async () => button.click());
    await flush();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect((transcribe.mock.calls[0] as unknown as [Blob])[0].type).toBe("audio/webm;codecs=opus");
    expect(onText).toHaveBeenCalledWith("renew my permit");
    expect(track.stop).toHaveBeenCalled();
    expect(button.dataset.state).toBe("idle");
  });

  it("should_ask_for_the_microphone_when_the_browser_refuses_it", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const onProblem = vi.fn();
    const { container } = await mount(<Mic transcribe={vi.fn()} onText={() => {}} onProblem={onProblem} />);

    await act(async () => container.querySelector("button")!.click());

    expect(onProblem).toHaveBeenCalledWith("Allow this site to use the microphone, then try again.");
    expect(container.querySelector("button")!.dataset.state).toBe("idle");
  });

  it("should_pass_on_the_platform_refusal_when_transcription_fails", async () => {
    const onProblem = vi.fn();
    const refusal = new Error("Voice input is not set up.");
    const { container } = await mount(<Mic transcribe={vi.fn(async () => Promise.reject(refusal))} onText={() => {}} onProblem={onProblem} />);
    const button = container.querySelector("button")!;

    await act(async () => button.click());
    await act(async () => button.click());
    await flush();

    expect(onProblem).toHaveBeenCalledWith("Voice input is not set up.", refusal);
  });

  it("should_say_so_when_the_recording_held_no_speech", async () => {
    const onProblem = vi.fn();
    const onText = vi.fn();
    const { container } = await mount(<Mic transcribe={vi.fn(async () => "")} onText={onText} onProblem={onProblem} />);
    const button = container.querySelector("button")!;

    await act(async () => button.click());
    await act(async () => button.click());
    await flush();

    expect(onText).not.toHaveBeenCalled();
    expect(onProblem).toHaveBeenCalledWith("No speech was heard. Try again.");
  });
});

describe("withSpoken", () => {
  it("should_add_spoken_text_after_the_draft_with_one_space", () => {
    expect(withSpoken("", "hello")).toBe("hello");
    expect(withSpoken("   ", "hello")).toBe("hello");
    expect(withSpoken("My card is ", "1234")).toBe("My card is 1234");
  });
});
