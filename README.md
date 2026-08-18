# dork

A Z-machine interpreter in TypeScript — plays Infocom-era interactive fiction in
the browser or from a script. Supports Z-machine versions 3 through 8.

Zork I ships with it, so there's nothing to download:

```bash
bun install
bun run dev
```

Then open <http://localhost:3000>. Use the toolbar to load your own `.z3`/`.z5`/
`.z8` story file, or pass one by URL: `http://localhost:3000/?story=/path.z5`.

## What's in it

- **v3–v8 support** — status lines, split windows, cursor control, text styles
  and colour, timed input, custom alphabet and Unicode translation tables.
- **Save and restore** — Quetzal-format saves to `localStorage`, plus download
  and upload so saves survive a cleared browser.
- **Conformance tested** against CZECH, Praxix, StrictZ, `unicode` and
  `crashme`, and byte-compared against `dfrotz` on a 365-command Zork I
  walkthrough.
- **Usable as a library** — the core has no DOM dependency.

## Library use

```ts
import { ZMachine, type ZMachineIO } from 'dork';

const story = new Uint8Array(await Bun.file('story.z5').arrayBuffer());
await new ZMachine(story, io).run();
```

Implement `ZMachineIO` to drive it from anywhere. `dork/io-xterm` provides an
xterm.js front end, and `dork/save-storage` and `dork/save-prompt` handle saves.

## Development

```bash
bun test          # run the suite
bun run lint      # oxlint --type-aware
```

Some tests exercise a corpus of commercial Infocom games (Trinity, A Mind
Forever Voyaging, Hitchhiker's, …). Those games are still proprietary and are
not distributed here, so those tests skip automatically unless the corpus is
present locally — see `CLAUDE.md` for the expected layout.

## Licensing

`dork` is MIT licensed — see [LICENSE](LICENSE).

The interpreter core began as a port of zzo38's public-domain **JSZM**. The
bundled **Zork I** story file (Release 119) is MIT licensed, courtesy of the
2025 Microsoft/Activision open-source release. Full attributions, including the
bundled test fixtures, are in [NOTICE.md](NOTICE.md).

No trademark rights are granted by any of the above. This is an unaffiliated
hobby project, not endorsed by Microsoft, Xbox, Activision or Infocom.
