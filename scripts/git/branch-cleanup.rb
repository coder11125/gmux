#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class BranchCleanup
      def initialize(options = {})
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @force = options[:force] || false
        @merged_only = options[:merged_only] || false
        @older_than = options[:older_than]
        @worktree = options[:worktree] || Dir.pwd
        @keep_branches = options[:keep_branches] || ['main', 'master', 'develop']
      end

      def run
        puts "=== GMUX Branch Cleanup ==="
        puts "Worktree: #{@worktree}"
        puts

        unless git_repository?
          puts "Error: Not a git repository"
          return
        end

        # Fetch latest from remote
        fetch_remote

        # Get current branch
        current_branch = get_current_branch
        puts "Current branch: #{current_branch}"
        puts

        # Get branches to cleanup
        branches = get_branches_to_cleanup
        
        if branches.empty?
          puts "No branches to cleanup."
          return
        end

        puts "Branches to cleanup:"
        branches.each do |branch|
          age = branch_age(branch)
          merged = branch_merged?(branch)
          puts "  - #{branch} (#{age} days old, merged: #{merged})"
        end
        puts

        if @dry_run
          puts "[DRY RUN] Would delete #{branches.length} branch(es)"
          return
        end

        unless @force
          print "Delete #{branches.length} branch(es)? [y/N] "
          return unless STDIN.gets.chomp.downcase == 'y'
        end

        # Delete branches
        deleted = delete_branches(branches)
        puts "Deleted #{deleted} branch(es)."
      end

      private

      def git_repository?
        system("git rev-parse --git-dir > /dev/null 2>&1", chdir: @worktree)
      end

      def fetch_remote
        puts "Fetching from remote..."
        system("git fetch --prune 2>/dev/null", chdir: @worktree)
      end

      def get_current_branch
        `git branch --show-current`.chomp
      end

      def get_branches_to_cleanup
        branches = []
        
        # Get all local branches
        output = `git branch --format='%(refname:short)'`.chomp
        local_branches = output.split("\n").reject(&:empty?)

        local_branches.each do |branch|
          # Skip current branch
          next if branch == get_current_branch

          # Skip protected branches
          next if @keep_branches.include?(branch)

          # Skip gmux main branches (not session branches)
          next if branch == 'main' || branch == 'master'

          # Check if merged
          merged = branch_merged?(branch)
          next if @merged_only && !merged

          # Check age if specified
          if @older_than
            age = branch_age(branch)
            next if age < @older_than
          end

          # Only include gmux session branches or merged branches
          if branch.start_with?('gmux-') || merged
            branches << branch
          end
        end

        branches
      end

      def branch_merged?(branch)
        # Check if branch is merged into main/master
        main_branch = get_main_branch
        output = `git branch --merged #{main_branch} --format='%(refname:short)'`.chomp
        merged_branches = output.split("\n").reject(&:empty?)
        merged_branches.include?(branch)
      end

      def get_main_branch
        # Check if main or master exists
        output = `git branch --format='%(refname:short)'`.chomp
        branches = output.split("\n").reject(&:empty?)
        
        if branches.include?('main')
          'main'
        elsif branches.include?('master')
          'master'
        else
          'HEAD'
        end
      end

      def branch_age(branch)
        # Get last commit date for branch
        output = `git log -1 --format='%ai' #{branch} 2>/dev/null`.chomp
        return 0 if output.empty?

        begin
          last_commit = Time.parse(output)
          (Time.now - last_commit) / (24 * 3600)
        rescue
          0
        end
      end

      def delete_branches(branches)
        deleted = 0
        branches.each do |branch|
          puts "  Deleting: #{branch}" if @verbose
          output = `git branch -d #{branch} 2>&1`
          if $?.success?
            deleted += 1
          else
            puts "    Warning: #{output.strip}"
            # Try force delete if -d fails
            if @force
              output = `git branch -D #{branch} 2>&1`
              if $?.success?
                deleted += 1
                puts "    Force deleted: #{branch}" if @verbose
              else
                puts "    Error: #{output.strip}"
              end
            end
          end
        end
        deleted
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-m', '--merged-only', "Only delete merged branches") do
      options[:merged_only] = true
    end

    opts.on('-d', '--older-than DAYS', Integer, "Only delete branches older than N days") do |d|
      options[:older_than] = d
    end

    opts.on('-k', '--keep BRANCH', Array, "Branches to keep (default: main,master,develop)") do |k|
      options[:keep_branches] = k
    end

    opts.on('-n', '--dry-run', "Show what would be deleted") do
      options[:dry_run] = true
    end

    opts.on('-f', '--force', "Force delete unmerged branches") do
      options[:force] = true
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-w', '--worktree PATH', "Worktree path (default: current directory)") do |w|
      options[:worktree] = w
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::BranchCleanup.new(options).run
end
