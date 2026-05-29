#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class Logger
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')
      LOG_DIR = File.join(Dir.home, '.gmux', 'logs')

      def initialize(options = {})
        @interval = options[:interval] || 10
        @verbose = options[:verbose] || false
        @log_dir = options[:log_dir] || LOG_DIR
        @watch_session = options[:session]
        @rotate = options[:rotate] || false
        @max_size = options[:max_size] || 10 * 1024 * 1024  # 10MB
        @compress = options[:compress] || false
        @format = options[:format] || 'text'
      end

      def run
        puts "=== GMUX Session Logger ==="
        puts "Interval: #{@interval}s"
        puts "Log dir: #{@log_dir}"
        puts

        ensure_log_dir

        if @rotate
          rotate_logs
        else
          capture_logs
        end
      end

      private

      def ensure_log_dir
        FileUtils.mkdir_p(@log_dir)
      end

      def load_sessions
        return {} unless File.exist?(STORE_PATH)
        JSON.parse(File.read(STORE_PATH))
      rescue JSON::ParserError
        {}
      end

      def capture_logs
        puts "Capturing logs... (Ctrl+C to stop)"
        puts

        running = true
        trap("INT") { running = false }

        while running
          sessions = load_sessions
          sessions_to_watch = @watch_session ?
            sessions.select { |name, _| name == @watch_session } :
            sessions.select { |_, s| s['status'] == 'running' }

          if sessions_to_watch.empty?
            print "\r  No running sessions to capture..."
            sleep @interval
            next
          end

          sessions_to_watch.each do |name, session|
            capture_session_log(name, session)
          end

          sleep @interval
        end

        puts "\nStopped capturing."
      end

      def capture_session_log(session_name, session)
        pane_id = session['tmuxPaneId']
        return unless pane_id

        log_file = get_log_file(session_name)

        # Capture pane output
        output = `tmux capture-pane -t #{pane_id} -p -S -500 2>/dev/null`
        return unless $?.success?

        # Append to log file
        File.open(log_file, 'a') do |f|
          f.puts "=" * 60
          f.puts "Capture at: #{Time.now.iso8601}"
          f.puts "Session: #{session_name}"
          f.puts "Pane: #{pane_id}"
          f.puts "-" * 60
          f.puts output
          f.puts
        end

        puts "  Captured: #{session_name} -> #{File.basename(log_file)}" if @verbose
      end

      def get_log_file(session_name)
        timestamp = Time.now.strftime('%Y-%m-%d')
        extension = @format == 'json' ? 'json' : 'log'
        File.join(@log_dir, "#{session_name}_#{timestamp}.#{extension}")
      end

      def rotate_logs
        puts "Rotating logs..."
        puts

        log_files = Dir.glob(File.join(@log_dir, '*.log'))
        log_files.each do |log_file|
          size = File.size(log_file)
          next if size < @max_size

          puts "  Rotating: #{File.basename(log_file)} (#{format_size(size)})"

          # Create rotated file
          timestamp = Time.now.strftime('%Y%m%d_%H%M%S')
          rotated_file = "#{log_file}.#{timestamp}"

          if @compress
            # Compress and remove original
            system("gzip -c #{log_file} > #{rotated_file}.gz")
            File.delete(log_file)
            puts "    Compressed: #{File.basename(rotated_file)}.gz"
          else
            # Just rename
            File.rename(log_file, rotated_file)
            puts "    Renamed: #{File.basename(rotated_file)}"
          end
        end

        puts "Rotation complete."
      end

      def format_size(bytes)
        if bytes >= 1024 * 1024
          "#{(bytes / (1024.0 * 1024.0)).round(2)} MB"
        elsif bytes >= 1024
          "#{(bytes / 1024.0).round(2)} KB"
        else
          "#{bytes} B"
        end
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-i', '--interval SECONDS', Integer, "Capture interval in seconds (default: 10)") do |i|
      options[:interval] = i
    end

    opts.on('-s', '--session NAME', "Capture specific session") do |s|
      options[:session] = s
    end

    opts.on('-d', '--log-dir DIR', "Log directory (default: ~/.gmux/logs)") do |d|
      options[:log_dir] = d
    end

    opts.on('-r', '--rotate', "Rotate large log files") do
      options[:rotate] = true
    end

    opts.on('-m', '--max-size BYTES', Integer, "Max log size before rotation (default: 10MB)") do |m|
      options[:max_size] = m
    end

    opts.on('-z', '--compress', "Compress rotated logs") do
      options[:compress] = true
    end

    opts.on('-f', '--format FORMAT', %w[text json], "Log format (text, json)") do |f|
      options[:format] = f
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::Logger.new(options).run
end
