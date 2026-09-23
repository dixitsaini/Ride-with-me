# Location domain foundation

This module provides the shared location model and the platform-independent boundaries for future ride, navigation, trip, and safety features.

Core principles:

- Normalize values to a single shared model.
- Keep feature modules dependent on the shared location service, not on native APIs.
- Keep the state machine explicit and centralized.
- Allow platform adaptations behind a service interface.
- Keep map-facing logic separate from the core domain logic.
