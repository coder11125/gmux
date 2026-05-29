#!/usr/bin/env zsh

_gmux_commands="list doctor scripts attach detach kill rename git completion"
_gmux_scripts="cleanup health export stats auto-commit branch-cleanup conflict-helper pr-ready watcher notifier logger backup restore diagnostics"
_gmux_git_commands="status diff log blame stash conflict"

_gmux_list_sessions() {
  local store="$HOME/.gmux/sessions.json"
  if [[ -f "$store" ]]; then
    python3 -c "import json,sys; d=json.load(open('$store')); [print(k) for k in d]" 2>/dev/null
  fi
}

_gmux() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C \
    '1:command:->commands' \
    '*::subcmd:->subcmd'

  case $state in
    commands)
      _describe 'command' _gmux_commands
      ;;
    subcmd)
      case $line[1] in
        scripts)
          _describe 'script' _gmux_scripts
          ;;
        attach|detach|kill)
          _arguments '2:session:($(_gmux_list_sessions))'
          ;;
        git)
          _describe 'subcommand' _gmux_git_commands
          ;;
        completion)
          _arguments '2:shell:(bash zsh)'
          ;;
        list|doctor)
          _arguments '-j[--json]' '-v[--verbose]'
          ;;
      esac
      ;;
  esac
}

compdef _gmux gmux
