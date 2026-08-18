# Test fixtures — provenance and licensing

These are Z-machine conformance suites written by the interactive-fiction
community to exercise interpreters. All are redistributable; this file records
where each came from and under what terms.

The `czech.z*` files are our own Inform 6 builds from upstream `czech.inf`
(`inform6 -v3 czech.inf`, etc.), so they are derived works of that source. The
rest are byte-identical copies of their upstream binaries.

| File | What it tests | Author | Terms |
| --- | --- | --- | --- |
| `czech.z3/z4/z5/z8`, `czech.out3/4/5/8` | Broad spec compliance (~425 tests at v5) | Amir Karger, from Evin Robertson's nitfol script | Permissive, notice must be preserved — see below |
| `praxix.z5` | Arithmetic edge cases, `inc_chk`/`dec_chk` wraparound, `get_prop_len(0)` | Andrew Plotkin and Dannii Willis | Public domain |
| `strictz.z5` | Object-0 operations don't crash or corrupt the default-property table | Torbjörn Andersson | Public domain (IF Archive interpreter tools) |
| `unicode.z5` | Unicode translation table, `print_unicode` | David Kinder, 2002 | Public domain (IF Archive interpreter tools) |
| `crashme.z5` | Interpreter survives executing random self-modifying Z-code | Evin Robertson, 1999 | Public domain (stated in `crashme.inf`) |

## Sources

- CZECH, `crashme`, `strictz`, `unicode`: <https://github.com/jeffnyman/zifmia>
  (`testers/`), which mirrors the IF Archive copies.
- Praxix: <https://github.com/curiousdannii/if> (`tests/praxix.z5`). That
  repository states: *"Unless otherwise noted files in this repository are
  released to the public domain."* Our copy is byte-identical
  (`md5 8ec79cd69d09cd5fe0ae1152a9b7c495`).

## CZECH license

CZECH is the one fixture with an explicit license that requires the notice be
carried along. Reproduced verbatim from its `README.txt`:

> Czech, v0.8
> Copyright (C) 2003, Amir Karger
>
> The copyright holder hereby grants the rights of usage, distribution
> and modification of this software to everyone and for any purpose, as
> long as this license and the copyright notice above are preserved and
> not modified.  There is no warranty for this software.

`czech.inf` additionally notes it is *"Based on nitfol test script, by Evin
Robertson, which was placed in the public domain."*
