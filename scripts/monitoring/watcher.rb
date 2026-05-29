#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class Watcher
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')
      LOG_DIR = File.join(Dir.home, '.gmux', 'logs')

      ERROR_PATTERNS = [
        /error/i,
        /exception/i,
        /failed/i,
        /fatal/i,
        /panic/i,
        /crash/i,
        /killed/i,
        /segfault/i,
        /errno/i,
        /EACCES/i,
        /ENOENT/i,
        /ENOMEM/i,
        /timeout/i,
        /timed out/i,
        /connection refused/i,
        /permission denied/i,
        /no such file/i,
        /command not found/i,
        /syntax error/i,
        /undefined symbol/i,
        /module not found/i,
        /import error/i,
        /cannot find/i,
        /not found/i,
        /denied/i,
        /forbidden/i,
      ].freeze

      def initialize(options = {})
        @interval = options[:interval] || 5
        @verbose = options[:verbose] || false
        @log_file = options[:log_file]
        @patterns = options[:patterns] || []
        @watch_session = options[:session]
        @tail = options[:tail] || false
      end

      def run
        puts "=== GMUX Agent Watcher ==="
        puts "Interval: #{@interval}s"
        puts "Patterns: #{@patterns.length > 0 ? @patterns.join(', ') : 'default error patterns'}"
        puts

        ensure_log_dir

        if @tail
          tail_output
        else
          watch_sessions
        end
      end

      private

      def ensure_log_dir
        FileUtils.mkdir_p(LOG_DIR)
      end

      def load_sessions
        return {} unless File.exist?(STORE_PATH)
        JSON.parse(File.read(STORE_PATH))
      rescue JSON::ParserError
        {}
      end

      def watch_sessions
        puts "Watching for errors... (Ctrl+C to stop)"
        puts

        running = true
        trap("INT") { running = false }

        while running
          sessions = load_sessions
          sessions_to_watch = @watch_session ?
            sessions.select { |name, _| name == @watch_session } :
            sessions.select { |_, s| s['status'] == 'running' }

          if sessions_to_watch.empty?
            print "\r  No running sessions to watch..."
            sleep @interval
            next
          end

          sessions_to_watch.each do |name, session|
            watch_session(name, session)
          end

          sleep @interval
        end

        puts "\nStopped watching."
      end

      def watch_session(name, session)
        pane_id = session['tmuxPaneId']
        return unless pane_id

        # Get recent output from tmux pane
        output = capture_pane_output(pane_id)
        return if output.empty?

        # Check for errors
        errors = detect_errors(output)
        if errors.any?
          log_errors(name, errors)
          display_errors(name, errors)
        end
      end

      def capture_pane_output(pane_id)
        # Capture last 100 lines from tmux pane
        result = `tmux capture-pane -t #{pane_id} -p -S -100 2>/dev/null`
        $?.success? ? result : ''
      end

      def detect_errors(output)
        errors = []
        lines = output.split("\n")

        lines.each_with_index do |line, i|
          # Skip empty lines
          next if line.strip.empty?

          # Check against patterns
          patterns_to_check = @patterns.empty? ? ERROR_PATTERNS : @patterns.map { |p| Regexp.new(p) }

          patterns_to_check.each do |pattern|
            if line.match?(pattern)
              errors << {
                line: i + 1,
                content: line.strip,
                pattern: pattern.source
              }
              break
            end
          end
        end

        errors.uniq { |e| e[:content] }
      end

      def log_errors(session_name, errors)
        timestamp = Time.now.strftime('%Y-%m-%d_%H-%M-%S')
        log_file = @log_file || File.join(LOG_DIR, "#{session_name}_errors.log")

        File.open(log_file, 'a') do |f|
          f.puts "=" * 60
          f.puts "Session: #{session_name}"
          f.puts "Time: #{Time.now.iso8601}"
          f.puts "Errors found: #{errors.length}"
          f.puts "-" * 60
          errors.each do |error|
            f.puts "Line #{error[:line]}: #{error[:content]}"
          end
          f.puts
        end

        puts "  Logged #{errors.length} error(s) to: #{log_file}" if @verbose
      end

      def display_errors(session_name, errors)
        puts
        puts "  [!] #{session_name}: #{errors.length} error(s) detected"
        errors.first(5).each do |error|
          puts "      Line #{error[:line]}: #{error[:content][0..80]}"
        end
        puts "      ... and #{errors.length - 5} more" if errors.length > 5
      end

      def tail_output
        puts "Tailing output... (Ctrl+C to stop)"
        puts

        running = true
        trap("INT") { running = false }

        sessions = load_sessions
        sessions_to_watch = @watch_session ?
          sessions.select { |name, _| name == @watch_session } :
          sessions.select { |_, s| s['status'] == 'running' }

        if sessions_to_watch.empty?
          puts "No running sessions to tail."
          return
        end

        pane_ids = sessions_to_watch.map { |_, s| s['tmuxPaneId'] }.compact

        # Use tmux pipe-pane for real-time output
        pane_ids.each do |pane_id|
          puts "Tailing pane: #{pane_id}"
          system("tmux pipe-pane -t #{pane_id} 'cat >> #{LOG_DIR}/pane_#{pane_id}.log'")
        end

        # Monitor log files
        while running
          pane_ids.each do |pane_id|
            log_file = File.join(LOG_DIR, "pane_#{pane_id}.log")
            next unless File.exist?(log_file)

            # Check for new content
            size = File.size(log_file)
            if size > @last_sizes[pane_id]
              content = File.read(log_file, offset: @last_sizes[pane_id])
              print content
              @last_sizes[pane_id] = size
            end
          end
          sleep 0.1
        end

        # Stop pipe-pane
        pane_ids.each do |pane_id|
          system("tmux pipe-pane -t #{pane_id} -c")
        end

        puts "\nStopped tailing."
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = { last_sizes: {} }
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-i', '--interval SECONDS', Integer, "Check interval in seconds (default: 5)") do |i|
      options[:interval] = i
    end

    opts.on('-s', '--session NAME', "Watch specific session") do |s|
      options[:session] = s
    end

    opts.on('-p', '--pattern REGEX', Array, "Custom error patterns (regex)") do |p|
      options[:patterns] = p
    end

    opts.on('-l', '--log-file FILE', "Log errors to file") do |l|
      options[:log_file] = l
    end

    opts.on('-t', '--tail', "Tail pane output in real-time") do
      options[:tail] = true
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::Watcher.new(options).run
end
