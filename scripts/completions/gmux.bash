#!/usr/bin/env bash

_gmux_commands="list doctor scripts attach detach kill rename git completion"
_gmux_scripts="cleanup health export stats auto-commit branch-cleanup conflict-helper pr-ready watcher notifier logger backup restore diagnostics"
_gmux_git_commands="status diff log blame stash conflict"

_gmux_list_sessions() {
  local store="$HOME/.gmux/sessions.json"
  if [[ -f "$store" ]]; then
    python3 -c "import json,sys; d=json.load(open('$store')); [print(k) for k in d]" 2>/dev/null || return 0
  fi
}

_gmux_completions() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  local prev="${COMP_WORDS[COMP_CWORD-1]}"
  local cmd="${COMP_WORDS[1]}"

  if [[ $COMP_CWORD -eq 1 ]]; then
    mapfile -t COMPREPLY < <(compgen -W "$_gmux_commands" -- "$cur")
    return 0
  fi

  case "$cmd" in
    scripts)
      if [[ $COMP_CWORD -eq 2 ]]; then
        mapfile -t COMPREPLY < <(compgen -W "$_gmux_scripts" -- "$cur")
      fi
      ;;
    attach|detach|kill)
      if [[ $COMP_CWORD -eq 2 ]]; then
        mapfile -t COMPREPLY < <(compgen -W "$(_gmux_list_sessions)" -- "$cur")
      fi
      ;;
    git)
      if [[ $COMP_CWORD -eq 2 ]]; then
        mapfile -t COMPREPLY < <(compgen -W "$_gmux_git_commands" -- "$cur")
      fi
      ;;
    completion)
      if [[ $COMP_CWORD -eq 2 ]]; then
        mapfile -t COMPREPLY < <(compgen -W "bash zsh" -- "$cur")
      fi
      ;;
    list|doctor)
      mapfile -t COMPREPLY < <(compgen -W "--json --verbose" -- "$cur")
      ;;
  esac

  # complete flag values
  case "$prev" in
    -A|--agent)
      mapfile -t COMPREPLY < <(compgen -W "codex pi aider claude-code" -- "$cur")
      ;;
    -a|--agents)
      mapfile -t COMPREPLY < <(compgen -W "1 2 3 4 5 6 7 8" -- "$cur")
      ;;
  esac
}

complete -F _gmux_completions gmux
