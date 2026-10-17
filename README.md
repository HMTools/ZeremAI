<p align="center"><img src="assets/hero.webp" alt="ZeremAI: a surfing agentic panda" width="100%"></p>

# ZeremAI

A Claude Code plugin for long-running, multi-step workflows. Start from reusable templates, track progress across sessions, gate steps behind your approval, and keep a full audit log.

## 📖 Documentation

**https://zerem-ai.mintlify.app**

Install guide, quick start, concepts, authoring templates and steps, and the full reference all live there. This repo holds the source code only.

## Install

```bash
# inside Claude Code
/plugin marketplace add HMTools/ZeremAI
```

```bash
claude plugin install zeremai@zeremai
```

Then run `/zeremai:init`. It opens the ZeremAI site, a live page on claude.ai where you start flows, approve steps and manage templates. Needs a Claude Code build with mods and a claude.ai sign-in. See the [installation guide](https://zerem-ai.mintlify.app/guide/installation) and [the site](https://zerem-ai.mintlify.app/guide/live-site) and its [UI tour](https://zerem-ai.mintlify.app/ui/flows).

## Links

- [Docs](https://zerem-ai.mintlify.app)
- [Roadmap](https://zerem-ai.mintlify.app/roadmap)
- [Official templates](https://github.com/HMTools/ZeremAI-marketplace)
- [Issues](https://github.com/HMTools/ZeremAI/issues)

## Contributing

- Plugin code: open a pull request here.
- Templates: contribute to [ZeremAI-marketplace](https://github.com/HMTools/ZeremAI-marketplace).
- Docs: edit the pages in [`site/`](site/) (Mintlify). Preview with `cd site && npx mint dev`.

## License

MIT
