# LABS tools for AI agents

The LABS surfacing tools (Seam Check, Seam Solver, G3 Blend, Class-A Fit, Patch Layout) are one
registry, `web/src/labsTools.js`, used three ways:

1. **Surfacing Agent in the app** (LABS rail, last icon). Type a request; Claude works through it with
   the tools, measuring before and after. A status strip over the viewport shows the step it is on
   and the last seam's targets (green met, red missed); seams light up on the model as they are
   measured; a summary card shows each seam against every target at the end. Enter keeps every
   change, Escape (or DISCARD) undoes all of them. Each change is also a history step.
   The agent uses **your own Anthropic API key**, entered in the panel (or Ctrl+K Ask): the desktop
   app saves it for your user on this computer, the browser keeps it in the tab only. It is never
   written to a .w3d file or the repository.
2. **MCP server** for Claude Desktop, Claude Code or any MCP client. No API key: the client brings
   the model. It runs headless on the browser build's kernel over STEP files.
3. **Headless** from node: `labsSession(new LocalBackend(), ...)` and `runLabsTool`.

## MCP server

    node <repo>/web/mcp/server.mjs

Run `npm install` in `web/` once first. Claude Code:

    claude mcp add witness-labs -- node /path/to/Witness-3D/web/mcp/server.mjs

Claude Desktop (`claude_desktop_config.json`):

    { "mcpServers": { "witness-labs": { "command": "node", "args": ["/path/to/Witness-3D/web/mcp/server.mjs"] } } }

Tools: `open_step`, `describe_model`, `seam_check`, `seam_solve`, `g3_blend`, `class_a_fit`,
`patch_layout`, `undo_last`, `save_step`. Every tool returns measured numbers as JSON. Paths are
absolute. `undo_last` only undoes steps made since the file was opened.
