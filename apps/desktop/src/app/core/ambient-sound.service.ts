import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AppStateService } from './app-state.service';
import { shouldPlayAmbient, startAmbient, stopAmbient, type AmbientGraph } from './ambient-sound';

/**
 * Keeps the ambient layer in step with the session, from outside the focus screen.
 *
 * A root service for the same reason the focus clock is one: the sound does not belong to the screen
 * that offers the toggle. The learner can leave `/focus` for the dashboard in the middle of a session
 * and the layer has to survive that route change, and it has to stop when the session ends wherever
 * they are. What this class does *not* decide is whether the learner wants sound at all — that is the
 * stored preference, read through `AppStateService`.
 */
@Injectable({ providedIn: 'root' })
export class AmbientSoundService {
  /** Whether sound is actually coming out, which is not the same as the preference being on. */
  readonly playing = signal(false);

  private readonly state = inject(AppStateService);
  private graph: AmbientGraph | null = null;
  private context: AudioContext | null = null;

  constructor() {
    effect(() => {
      const wanted = shouldPlayAmbient(this.state.ambientSound(), this.state.snapshot() !== null);
      untracked(() => this.apply(wanted));
    });
  }

  private apply(wanted: boolean): void {
    if (wanted === (this.graph !== null)) return;
    if (wanted) this.play();
    else this.stop();
  }

  private play(): void {
    /*
     * A window that cannot make the sound must still run the session, so a missing or refusing
     * `AudioContext` leaves the layer silent rather than reporting an error over the learner's task.
     * The gesture that turned it on is also what lets a browser start one.
     */
    if (typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
      this.graph = startAmbient(this.context);
      this.playing.set(true);
    } catch {
      this.graph = null;
      this.playing.set(false);
    }
  }

  private stop(): void {
    if (this.graph !== null) {
      stopAmbient(this.graph);
      this.graph = null;
    }
    this.playing.set(false);
  }
}
