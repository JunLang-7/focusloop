/**
 * The generated ambient layer (#57).
 *
 * Nothing is shipped and nothing is downloaded: brown noise through a low-pass filter is what the
 * focus-noise players are underneath, and the Web Audio API can build it at run time. So there is one
 * rule and two functions — the rule is testable without an audio device, and the graph is readable
 * without a component.
 */

/**
 * Whether the layer should be audible, from the two facts that decide it.
 *
 * The preference is not a playback state. A learner who left the layer on and closed the app must not
 * be met by sound they did not ask for *now*, so the session is what starts it — and, for the same
 * reason, what stops it. One function rather than a rule spread over the toggle and the session end.
 */
export function shouldPlayAmbient(preference: boolean, sessionRunning: boolean): boolean {
  return preference && sessionRunning;
}

/** The two nodes the layer keeps, so that the same ones can be stopped afterwards. */
export interface AmbientGraph {
  readonly source: AudioScheduledSourceNode;
  readonly gain: GainNode;
}

/** Audible in a quiet room, and below anything the learner presses: the layer is not the task. */
const AMBIENT_GAIN = 0.08;

/** The cutoff that turns noise into a wash rather than a hiss. */
const AMBIENT_CUTOFF_HZ = 500;

/**
 * Builds the graph and starts it: brown noise, looped, filtered, at a fixed quiet level.
 *
 * The buffer is two seconds rather than a long one because it loops; a longer one would be the same
 * sound with more memory behind it.
 */
export function startAmbient(context: AudioContext): AmbientGraph {
  const seconds = 2;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < samples.length; index += 1) {
    // White noise integrated a step at a time is brown noise: each sample is the last one plus a
    // small random walk, which is what moves the energy to the low end.
    previous = (previous + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    samples[index] = previous * 3.5;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = AMBIENT_CUTOFF_HZ;

  const gain = context.createGain();
  gain.gain.value = AMBIENT_GAIN;

  source.connect(filter).connect(gain).connect(context.destination);
  source.start();

  return { source, gain };
}

/**
 * Stops the layer and lets its nodes go.
 *
 * `stop` is the only way a looping source ends and it throws when it is already stopped, which is a
 * state this can genuinely be in: the learner presses the toggle off in the same tick the session
 * ends. Nothing is left to clean up in the graph itself.
 */
export function stopAmbient(graph: AmbientGraph): void {
  try {
    graph.source.stop();
  } catch {
    // Already stopped. Not a failure, and not worth a banner over the learner's screen.
  }
  graph.source.disconnect();
  graph.gain.disconnect();
}
