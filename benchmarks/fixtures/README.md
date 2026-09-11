# Benchmark fixtures

Real firmware dumps go here, and they are gitignored — they are somebody's
firmware, and this repository is not where it belongs.

`npm run bench` picks the largest file in this directory, or the one
`$BENCH_FIXTURE` points at. With nothing here it synthesises a 16 MB stand-in
and marks every number in its output as not to be trusted, which is what such a
number is: a dump comes off a disk, through the OS cache, with the layout a
flash chip actually has.

Put at least one 16 MB dump here before quoting a benchmark at anybody.
