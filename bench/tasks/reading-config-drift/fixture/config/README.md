# Environment configs

`dev.yaml`, `staging.yaml`, and `prod.yaml` should be kept consistent with
each other, with one exception: the following keys are expected to differ
per environment by design, and should **not** be "fixed" to match:

- `environment`
- `hostname`
- `region`
- `replica_count`
- `log_level`

Every other key must have the same value across environments. If staging
and prod disagree on any other key, that's config drift and a bug: prod
should be corrected to match staging (staging is the source of truth for
everything except the keys above).
