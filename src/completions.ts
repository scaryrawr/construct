// Shell completion scripts for construct

export function generateBashCompletion(): string {
  return `###-begin-construct-completions-###
#
# construct command completion script for bash
#
# Installation: construct completion bash >> ~/.bashrc
#    or construct completion bash >> ~/.bash_profile on OSX.
#
_construct_completions()
{
    local cur_word prev_word opts plugins

    cur_word="\${COMP_WORDS[COMP_CWORD]}"
    prev_word="\${COMP_WORDS[COMP_CWORD-1]}"

    opts="--list-available-plugins --enable-plugin --help --version completion"

    case "\${prev_word}" in
        --enable-plugin)
            # Suggest available plugins
            plugins=$(construct --list-available-plugins 2>/dev/null | grep -v "Available plugins:" | sed 's/^  //')
            COMPREPLY=( $(compgen -W "\${plugins}" -- "\${cur_word}") )
            return 0
            ;;
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur_word}") )
            return 0
            ;;
        *)
            ;;
    esac

    COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur_word}") )
    return 0
}

complete -F _construct_completions construct
###-end-construct-completions-###`;
}

export function generateZshCompletion(): string {
  return `###-begin-construct-completions-###
#
# construct command completion script for zsh
#
# Installation: construct completion zsh >> ~/.zshrc
#
_construct_completions()
{
    local -a opts plugins shells

    opts=(
        '--list-available-plugins:List all discoverable plugins'
        '--enable-plugin:Enable plugin(s) (format: <plugin>@<marketplace>)'
        '--help:Show help'
        '--version:Show version'
        'completion:Generate shell completion script'
    )

    shells=(
        'bash:Generate bash completion'
        'zsh:Generate zsh completion'
        'fish:Generate fish completion'
    )

    if (( CURRENT == 2 )); then
        _describe 'construct commands' opts
    elif [[ "\${words[2]}" == "completion" ]] && (( CURRENT == 3 )); then
        _describe 'shell types' shells
    elif [[ "\${words[CURRENT-1]}" == "--enable-plugin" ]]; then
        # Suggest available plugins
        local available_plugins
        available_plugins=(\${(f)"$(construct --list-available-plugins 2>/dev/null | grep -v "Available plugins:" | sed 's/^  //')"})
        _describe 'available plugins' available_plugins
    fi
}

compdef _construct_completions construct
###-end-construct-completions-###`;
}

export function generateFishCompletion(): string {
  return `###-begin-construct-completions-###
#
# construct command completion script for fish
#
# Installation: construct completion fish > ~/.config/fish/completions/construct.fish
#

# Main options
complete -c construct -l list-available-plugins -d "List all discoverable plugins"
complete -c construct -l enable-plugin -d "Enable plugin(s) (format: <plugin>@<marketplace>)" -r
complete -c construct -l help -s h -d "Show help"
complete -c construct -l version -s v -d "Show version"

# completion command
complete -c construct -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion script"
complete -c construct -n "__fish_seen_subcommand_from completion" -a "bash zsh fish" -d "Shell type"

# Dynamic plugin suggestions
complete -c construct -n "__fish_seen_subcommand_from --enable-plugin" -a "(construct --list-available-plugins 2>/dev/null | grep -v 'Available plugins:' | string trim)"
###-end-construct-completions-###`;
}
