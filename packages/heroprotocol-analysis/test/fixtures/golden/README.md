# Analysis goldens

One gzipped JSON per fixture replay: every built-in analyser's result (lazy ones under
their params hash), produced by `pnpm run generate.analysis-goldens` with floats
rounded to 6 places. They are regression baselines for these analysers — the 2018
analysers cannot be run, so parity with them is by construction, with the deviations
listed in the package README. Regenerate only for an intentional change, and bump the
changed analyser's `version`.
