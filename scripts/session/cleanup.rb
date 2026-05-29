#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class SessionCleanup
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')
      DEFAULT_MAX_AGE_DAYS = 7

      def initialize(options = {})
        @max_age_days = options[:max_age_days] || DEFAULT_MAX_AGE_DAYS
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @force = options[:force] || false
      end

      def run
        puts "=== GMUX Session Cleanup ==="
        puts "Max age: #{@max_age_days} days"
        puts "Dry run: #{@dry_run}"
        puts

        sessions = load_sessions
        if sessions.empty?
          puts "No sessions found."
          return
        end

        puts "Found #{sessions.length} session(s)"
        puts

        stale_sessions = find_stale_sessions(sessions)
        if stale_sessions.empty?
          puts "No stale sessions found."
          return
        end

        puts "Found #{stale_sessions.length} stale session(s):"
        stale_sessions.each do |name, session|
          age = session_age(session)
          puts "  - #{name} (#{age.round(1)} days old, status: #{session['status']})"
        end
        puts

        if @dry_run
          puts "[DRY RUN] Would remove #{stale_sessions.length} session(s)"
          return
        end

        unless @force
          print "Remove #{stale_sessions.length} stale session(s)? [y/N] "
          return unless STDIN.gets.chomp.downcase == 'y'
        end

        remove_sessions(stale_sessions)
        puts "Done. Removed #{stale_sessions.length} session(s)."
      end

      private

      def load_sessions
        return {} unless File.exist?(STORE_PATH)

        JSON.parse(File.read(STORE_PATH))
      rescue JSON::ParserError => e
        puts "Error parsing sessions file: #{e.message}"
        {}
      end

      def find_stale_sessions(sessions)
        now = Time.now
        sessions.select do |name, session|
          started_at = Time.parse(session['startedAt'])
          age_days = (now - started_at) / (24 * 3600)
          age_days > @max_age_days
        end
      end

      def session_age(session)
        now = Time.now
        started_at = Time.parse(session['startedAt'])
        (now - started_at) / (24 * 3600)
      end

      def remove_sessions(stale_sessions)
        stale_sessions.each do |name, session|
          remove_worktree(session['worktreePath']) if session['worktreePath']
          remove_tmux_window(session['tmuxWindowId']) if session['tmuxWindowId']
          remove_session_record(name)
          puts "  Removed: #{name}" if @verbose
        end
      end

      def remove_worktree(path)
        return unless File.directory?(path)

        puts "  Removing worktree: #{path}" if @verbose
        FileUtils.rm_rf(path)
      rescue StandardError => e
        puts "  Warning: Failed to remove worktree #{path}: #{e.message}"
      end

      def remove_tmux_window(window_id)
        puts "  Killing tmux window: #{window_id}" if @verbose
        system("tmux kill-window -t #{window_id} 2>/dev/null")
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

    opts.on('-d', '--max-days DAYS', Integer, "Max age in days (default: 7)") do |d|
      options[:max_age_days] = d
    end

    opts.on('-n', '--dry-run', "Show what would be removed without doing it") do
      options[:dry_run] = true
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-f', '--force', "Skip confirmation prompt") do
      options[:force] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::SessionCleanup.new(options).run
end
