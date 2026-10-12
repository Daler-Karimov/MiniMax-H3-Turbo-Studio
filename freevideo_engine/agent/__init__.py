"""Agent-native control of FreeVideo: job specs, media tools, headless edits and MCP.

The agent features are held back for now: they stay off, with no routes, token,
commands or controls, unless FREEVIDEO_AGENT=1 is set where ComfyUI runs (and
for the agent and mcp commands)."""
import os

API_VERSION = 1
SWITCH = 'FREEVIDEO_AGENT'


def enabled(environ=None):
    """Whether the agent features are on: FREEVIDEO_AGENT=1 (or true, yes, on)."""
    value = (os.environ if environ is None else environ).get(SWITCH, '')
    return value.strip().lower() in ('1', 'true', 'yes', 'on')
