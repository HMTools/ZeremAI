<p align="center"><img src="assets/hero.webp" alt="ZeremAI: a surfing agentic panda" width="100%"></p>

<h1 align="center">ZeremAI</h1>

<h3 align="center">Your agent works for days. You stay in control.</h3>

<p align="center">A deterministic orchestrator for Claude Code. Templates set the steps. Code runs them in order. Only you approve.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-D97757">
  <a href="https://zerem-ai.mintlify.app"><img alt="Docs" src="https://img.shields.io/badge/docs-zerem--ai.mintlify.app-0f766e"></a>
</p>

## One flow, two days

```text
MON 09:02  flow started     template: implement-feature
           step 1 explore   done
           step 2 plan      done
MON 09:15  step 3 approve   WAITING FOR YOU          you close the laptop

TUE 08:40  you reopen       no re-explaining, state is saved
           step 3 approve   approved by you
           step 4 build     running                  fresh context, only what it needs
           ...              audit log and findings saved at the end
```

*Illustrative.*

## Why use it

| The orchestrator is code, not a prompt | Only you approve | Resume at the exact step |
|---|---|---|
| Steps run in the order the template sets. State changes go through one checked script. | The agent cannot sign off its own work. Gates wait for you as long as you need. | Close the session today. Pick up tomorrow. Nothing to re-explain. |

<details>
<summary><b>4 more reasons</b></summary>

- **Fresh context for every step.** Each step runs in its own subagent and gets only what it needs.
- **Do it once, reuse it.** Fill a template once, run it again, share it from git.
- **A record of everything.** Every action goes in an audit log.
- **Gets better each run.** Each flow saves findings for you to review, and learns your preferences as flavors.

</details>

> [!TIP]
> Not sure a flow fits? Run `/zeremai:init` and start from an official template.

## Documentation

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

[MIT](LICENSE). Contributions use the same license, see [CONTRIBUTING](CONTRIBUTING.md).
