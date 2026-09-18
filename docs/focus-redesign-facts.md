# Product facts: Tiimo reference

Verified on 2026-09-18 for the FocusLoop focus-workspace redesign.

## Confirmed current product facts

- Tiimo describes itself as a visual AI planner available on iOS, iPadOS, watchOS,
  Android, and the web.
- Its focus timer is positioned as a visual anchor for time: the user can see time pass,
  stay with one task, and ease transitions rather than only read a numeric countdown.
- For scheduled tasks the timer can start automatically. The user can pause/resume, add one
  or more minutes, and drag the timer to the end when finishing early.
- Tiimo supports starting an anytime/to-do task directly and moving into the Focus tab.
- A running focus timer can remain visible through widgets, Live Activities, Dynamic Island,
  Apple Watch, and the web planner.
- Tiimo explicitly recommends starting small, using subtasks, and reducing interruptions with
  system focus modes.
- Apple named Tiimo the 2025 iPhone App of the Year and praised its calming, color-based visual
  timeline.

## Local product observation

The locally installed macOS build was inspected without adding or deleting user tasks.

- Idle state: a sparse canvas with one adjustable visual duration ring, a selected duration,
  and a single Start action.
- Running state: the ring becomes a progress object with an illustrated center, remaining time,
  the session time range, `+1 minute`, and pause.
- Paused state: the display becomes quieter and labels the state explicitly rather than showing
  an alarm or failure treatment.
- Optional Lo-Fi audio is present but visually secondary to the timer.
- Navigation and settings remain small and remote from the primary focus object.

## Sources

- Tiimo focus product page: <https://www.tiimoapp.com/product/focus>
- Tiimo focus timer FAQ: <https://www.tiimoapp.com/faq/focus-timer>
- Tiimo product overview: <https://www.tiimoapp.com/>
- Apple App Store Awards 2025: <https://developer.apple.com/app-store/app-store-awards-2025/>
