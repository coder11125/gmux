#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class SessionHealth
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')

      def initialize(options = {})
        @verbose = options[:verbose] || false
        @repair = options[:repair] || false
        @issues = []
      end

      def run
        puts "=== GMUX Session Health Check ==="
        puts

        sessions = load_sessions
        if sessions.empty?
          puts "No sessions found."
          return
        end

        puts "Checking #{sessions.length} session(s)..."
        puts

        check_orphaned_worktrees(sessions)
        check_missing_tmux_windows(sessions)
        check_missing_branches(sessions)
        check_stale_sessions(sessions)
        check_duplicate_worktrees(sessions)

        if @issues.empty?
          puts "All sessions are healthy!"
        else
          puts "Found #{@issues.length} issue(s):"
          @issues.each_with_index do |issue, i|
            puts "  #{i + 1}. #{issue[:severity].upcase}: #{issue[:message]}"
            puts "     Session: #{issue[:session]}" if issue[:session]
            puts "     Fix: #{issue[:fix]}" if issue[:fix] && @verbose
          end
          puts

          if @repair
            repair_issues
          else
            puts "Run with --repair to fix issues automatically."
          end
        end
      end

      private

      def load_sessions
        return {} unless File.exist?(STORE_PATH)

        JSON.parse(File.read(STORE_PATH))
      rescue JSON::ParserError => e
        puts "Error parsing sessions file: #{e.message}"
        {}
      end

      def check_orphaned_worktrees(sessions)
        worktree_dirs = sessions.values.map { |s| s['worktreePath'] }.compact
        gmux_dir = File.join(Dir.home, '.gmux')

        return unless File.directory?(gmux_dir)

        Dir.glob(File.join(gmux_dir, 'worktrees', '*')).each do |path|
          next unless File.directory?(path)
          next if worktree_dirs.include?(path)

          @issues << {
            severity: 'warning',
            message: "Orphaned worktree: #{path}",
            session: nil,
            fix: "Remove with: rm -rf #{path}",
            type: :orphaned_worktree,
            path: path
          }
        end
      end

      def check_missing_tmux_windows(sessions)
        sessions.each do |name, session|
          window_id = session['tmuxWindowId']
          next unless window_id

          output = `tmux list-windows -t #{window_id} 2>&1`
          next if $?.success?

          @issues << {
            severity: 'error',
            message: "Missing tmux window: #{window_id}",
            session: name,
            fix: "Session may need to be recreated",
            type: :missing_window,
            session_name: name
          }
        end
      end

      def check_missing_branches(sessions)
        sessions.each do |name, session|
          branch = session['branchName']
          worktree = session['worktreePath']
          next unless branch && worktree

          output = `git -C #{worktree} branch --list #{branch} 2>&1`
          next if output.strip.include?(branch)

          @issues << {
            severity: 'warning',
            message: "Missing branch: #{branch}",
            session: name,
            fix: "Branch may have been deleted",
            type: :missing_branch,
            session_name: name
          }
        end
      end

      def check_stale_sessions(sessions)
        now = Time.now
        sessions.each do |name, session|
          started_at = Time.parse(session['startedAt'])
          age_hours = (now - started_at) / 3600

          next unless age_hours > 24 && session['status'] == 'running'

          @issues << {
            severity: 'warning',
            message: "Stale running session (#{age_hours.round(1)} hours old)",
            session: name,
            fix: "Consider marking as complete or cleaning up",
            type: :stale_session,
            session_name: name
          }
        end
      end

      def check_duplicate_worktrees(sessions)
        worktrees = sessions.group_by { |_, s| s['worktreePath'] }
        worktrees.each do |path, entries|
          next unless entries.length > 1

          names = entries.map(&:first)
          @issues << {
            severity: 'error',
            message: "Duplicate worktree: #{path}",
            session: names.join(', '),
            fix: "Multiple sessions share the same worktree",
            type: :duplicate_worktree,
            path: path
          }
        end
      end

      def repair_issues
        puts "Repairing issues..."
        repaired = 0

        @issues.each do |issue|
          case issue[:type]
          when :orphaned_worktree
            FileUtils.rm_rf(issue[:path])
            puts "  Removed orphaned worktree: #{issue[:path]}"
            repaired += 1
          when :missing_window
            remove_session_record(issue[:session_name])
            puts "  Removed session record: #{issue[:session_name]}"
            repaired += 1
          end
        end

        puts "Repaired #{repaired} issue(s)."
      end

      def remove_session_record(name)
        sessions = load_sessions
        sessions.delete(name)
        File.write(STORE_PATH, JSON.pretty_generate(sessions))
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-r', '--repair', "Automatically fix issues") do
      options[:repair] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::SessionHealth.new(options).run
end
