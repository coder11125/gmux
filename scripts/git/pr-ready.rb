#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class PrReady
      def initialize(options = {})
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @force = options[:force] || false
        @skip_tests = options[:skip_tests] || false
        @skip_lint = options[:skip_lint] || false
        @worktree = options[:worktree] || Dir.pwd
      end

      def run
        puts "=== GMUX PR Ready ==="
        puts "Worktree: #{@worktree}"
        puts

        unless git_repository?
          puts "Error: Not a git repository"
          return
        end

        # Check if there are uncommitted changes
        unless working_clean?
          puts "Error: Working directory not clean"
          puts "Commit or stash changes first."
          return
        end

        # Get current branch
        current_branch = get_current_branch
        puts "Current branch: #{current_branch}"

        # Check if branch is gmux session branch
        unless current_branch.start_with?('gmux-')
          puts "Warning: Not a gmux session branch"
          unless @force
            print "Continue anyway? [y/N] "
            return unless STDIN.gets.chomp.downcase == 'y'
          end
        end

        # Check if branch is up to date
        unless up_to_date?
          puts "Branch is behind remote. Rebasing..."
          rebase_branch unless @dry_run
        end

        # Run tests unless skipped
        unless @skip_tests
          puts "Running tests..."
          unless run_tests
            puts "Tests failed. Fix issues before PR."
            return
          end
        end

        # Run lint unless skipped
        unless @skip_lint
          puts "Running lint..."
          unless run_lint
            puts "Lint failed. Fix issues before PR."
            return
          end
        end

        # Push branch
        puts "Pushing branch..."
        push_branch unless @dry_run

        # Create PR summary
        create_pr_summary unless @dry_run

        puts
        puts "Branch is ready for PR!"
      end

      private

      def git_repository?
        system("git rev-parse --git-dir > /dev/null 2>&1", chdir: @worktree)
      end

      def working_clean?
        output = `git status --porcelain`.chomp
        output.empty?
      end

      def get_current_branch
        `git branch --show-current`.chomp
      end

      def up_to_date?
        # Fetch latest
        system("git fetch origin 2>/dev/null", chdir: @worktree)
        
        # Check if behind
        output = `git rev-list --count HEAD..origin/#{get_current_branch} 2>/dev/null`.chomp
        count = output.to_i
        count == 0
      end

      def rebase_branch
        branch = get_current_branch
        system("git rebase origin/#{branch}", chdir: @worktree)
      end

      def run_tests
        # Try common test commands
        test_commands = [
          'bun test',
          'npm test',
          'yarn test',
          'pnpm test',
          'make test',
          'rake test',
          'pytest',
          'cargo test',
          'go test ./...'
        ]

        test_commands.each do |cmd|
          if File.exist?('package.json') && cmd.include?('npm')
            puts "  Running: #{cmd}"
            system(cmd, chdir: @worktree)
            return $?.success?
          elsif File.exist?('Cargo.toml') && cmd.include?('cargo')
            puts "  Running: #{cmd}"
            system(cmd, chdir: @worktree)
            return $?.success?
          elsif File.exist?('go.mod') && cmd.include?('go')
            puts "  Running: #{cmd}"
            system(cmd, chdir: @worktree)
            return $?.success?
          end
        end

        # Default to bun test if available
        if File.exist?('bun.lock') || File.exist?('package.json')
          puts "  Running: bun test"
          system('bun test', chdir: @worktree)
          return $?.success?
        end

        puts "  No test command found, skipping"
        true
      end

      def run_lint
        # Try common lint commands
        lint_commands = [
          'bun run lint',
          'npm run lint',
          'yarn lint',
          'pnpm lint',
          'make lint',
          'rubocop',
          'ruff check',
          'eslint .',
          'prettier --check .'
        ]

        lint_commands.each do |cmd|
          if File.exist?('package.json') && cmd.include?('npm')
            puts "  Running: #{cmd}"
            system(cmd, chdir: @worktree)
            return $?.success?
          end
        end

        # Default to bun run lint if available
        if File.exist?('bun.lock') || File.exist?('package.json')
          puts "  Running: bun run lint"
          system('bun run lint', chdir: @worktree)
          return $?.success?
        end

        puts "  No lint command found, skipping"
        true
      end

      def push_branch
        branch = get_current_branch
        system("git push -u origin #{branch}", chdir: @worktree)
      end

      def create_pr_summary
        branch = get_current_branch
        base_branch = get_base_branch
        
        # Get commit log
        commits = `git log --oneline #{base_branch}..HEAD`.chomp
        
        # Get diff stat
        diff_stat = `git diff --stat #{base_branch}..HEAD`.chomp

        puts
        puts "=== PR Summary ==="
        puts "Branch: #{branch}"
        puts "Base: #{base_branch}"
        puts
        puts "Commits:"
        puts commits
        puts
        puts "Changes:"
        puts diff_stat
      end

      def get_base_branch
        # Try to find main/master/develop
        output = `git branch --format='%(refname:short)'`.chomp
        branches = output.split("\n").reject(&:empty?)
        
        if branches.include?('main')
          'main'
        elsif branches.include?('master')
          'master'
        elsif branches.include?('develop')
          'develop'
        else
          'HEAD~1'
        end
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-s', '--skip-tests', "Skip running tests") do
      options[:skip_tests] = true
    end

    opts.on('-l', '--skip-lint', "Skip running lint") do
      options[:skip_lint] = true
    end

    opts.on('-w', '--worktree PATH', "Worktree path (default: current directory)") do |w|
      options[:worktree] = w
    end

    opts.on('-n', '--dry-run', "Show what would be done") do
      options[:dry_run] = true
    end

    opts.on('-f', '--force', "Skip confirmation prompts") do
      options[:force] = true
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::PrReady.new(options).run
end
