#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class AutoCommit
      CONVENTIONAL_PREFIXES = %w[
        feat fix docs style refactor perf test build ci chore revert
      ].freeze

      def initialize(options = {})
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @all = options[:all] || false
        @message = options[:message]
        @conventional = options[:conventional] || false
        @worktree = options[:worktree] || Dir.pwd
      end

      def run
        puts "=== GMUX Auto Commit ==="
        puts "Worktree: #{@worktree}"
        puts

        unless git_repository?
          puts "Error: Not a git repository"
          return
        end

        status = get_status
        if status[:staged].empty? && status[:unstaged].empty? && status[:untracked].empty?
          puts "Nothing to commit."
          return
        end

        display_changes(status)

        if @dry_run
          puts "[DRY RUN] Would commit with message:"
          puts "  #{generate_message(status)}"
          return
        end

        # Stage all changes if --all
        stage_all if @all

        # Check if there are staged changes
        staged = get_staged_files
        if staged.empty?
          puts "No staged changes. Use --all to stage all changes."
          return
        end

        message = @message || generate_message(status)
        commit(message)
        puts "Committed: #{message}"
      end

      private

      def git_repository?
        system("git rev-parse --git-dir > /dev/null 2>&1", chdir: @worktree)
      end

      def get_status
        output = `git status --porcelain`.chomp
        lines = output.split("\n").reject(&:empty?)

        staged = []
        unstaged = []
        untracked = []

        lines.each do |line|
          index_status = line[0]
          work_status = line[1]
          file = line[3..]

          if index_status == '?' && work_status == '?'
            untracked << file
          else
            staged << file if index_status != ' ' && index_status != '?'
            unstaged << file if work_status != ' ' && work_status != '?'
          end
        end

        { staged: staged, unstaged: unstaged, untracked: untracked }
      end

      def get_staged_files
        output = `git diff --cached --name-only`.chomp
        output.split("\n").reject(&:empty?)
      end

      def display_changes(status)
        puts "Changes:"
        puts "  Staged: #{status[:staged].length} file(s)" unless status[:staged].empty?
        puts "  Unstaged: #{status[:unstaged].length} file(s)" unless status[:unstaged].empty?
        puts "  Untracked: #{status[:untracked].length} file(s)" unless status[:untracked].empty?
        puts
      end

      def stage_all
        puts "Staging all changes..."
        system("git add -A", chdir: @worktree)
      end

      def generate_message(status)
        if @conventional
          generate_conventional_message(status)
        else
          generate_simple_message(status)
        end
      end

      def generate_simple_message(status)
        all_files = status[:staged] + status[:unstaged] + status[:untracked]
        
        if all_files.length == 1
          "Update #{all_files.first}"
        elsif all_files.length <= 3
          "Update #{all_files.join(', ')}"
        else
          "Update #{all_files.length} files"
        end
      end

      def generate_conventional_message(status)
        all_files = status[:staged] + status[:unstaged] + status[:untracked]
        
        # Determine type based on file changes
        type = detect_change_type(all_files)
        scope = detect_scope(all_files)
        
        # Generate description
        if all_files.length == 1
          description = describe_single_file(all_files.first)
        else
          description = "update #{all_files.length} files"
        end

        # Build message
        msg = type
        msg += "(#{scope})" if scope
        msg += ": #{description}"
        msg
      end

      def detect_change_type(files)
        # Check for specific file patterns
        has_test = files.any? { |f| f.match?(/test|spec|_test\./) }
        has_doc = files.any? { |f| f.match?(/\.md|\.txt|doc[s]?/) }
        has_config = files.any? { |f| f.match?(/config|\.yml|\.yaml|\.json|\.toml/) }
        has_ci = files.any? { |f| f.match?(/\.github|ci|pipeline/) }

        if has_test
          'test'
        elsif has_doc
          'docs'
        elsif has_config
          'chore'
        elsif has_ci
          'ci'
        else
          'feat'
        end
      end

      def detect_scope(files)
        # Extract common directory as scope
        dirs = files.map { |f| File.dirname(f).split('/').first }.compact.uniq
        
        if dirs.length == 1
          dirs.first
        elsif dirs.length > 1
          # Find common prefix
          common = dirs.first
          dirs.each { |d| common = common.split('/') & d.split('/') }
          common.first if common.is_a?(String) && !common.empty?
        end
      end

      def describe_single_file(file)
        basename = File.basename(file, '.*')
        ext = File.extname(file)
        
        case ext
        when '.rb'
          "add #{basename} script"
        when '.ts', '.js'
          "update #{basename} module"
        when '.md'
          "update #{basename} documentation"
        when '.json', '.yml', '.yaml', '.toml'
          "update #{basename} configuration"
        else
          "update #{basename}"
        end
      end

      def commit(message)
        puts "Committing: #{message}"
        system("git commit -m '#{message}'", chdir: @worktree)
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-m', '--message MSG', "Commit message") do |m|
      options[:message] = m
    end

    opts.on('-a', '--all', "Stage all changes before commit") do
      options[:all] = true
    end

    opts.on('-c', '--conventional', "Use conventional commit format") do
      options[:conventional] = true
    end

    opts.on('-w', '--worktree PATH', "Worktree path (default: current directory)") do |w|
      options[:worktree] = w
    end

    opts.on('-n', '--dry-run', "Show what would be committed") do
      options[:dry_run] = true
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::AutoCommit.new(options).run
end
