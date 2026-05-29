#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class SessionStats
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')

      def initialize(options = {})
        @verbose = options[:verbose] || false
        @detailed = options[:detailed] || false
        @json_output = options[:json] || false
      end

      def run
        sessions = load_sessions
        if sessions.empty?
          puts "No sessions found."
          return
        end

        stats = calculate_stats(sessions)

        if @json_output
          puts JSON.pretty_generate(stats)
        else
          display_stats(stats)
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

      def calculate_stats(sessions)
        now = Time.now
        total_duration = 0
        status_counts = { 'running' => 0, 'complete' => 0, 'error' => 0 }
        agent_counts = Hash.new(0)
        daily_counts = Hash.new(0)
        durations = []

        sessions.each do |name, session|
          # Status counts
          status = session['status']
          status_counts[status] = (status_counts[status] || 0) + 1

          # Agent usage
          agent = session['agentCommand']
          agent_counts[agent] += 1 if agent

          # Duration
          started_at = Time.parse(session['startedAt'])
          ended_at = session['endedAt'] ? Time.parse(session['endedAt']) : now
          duration = ended_at - started_at
          total_duration += duration
          durations << duration

          # Daily counts
          day = started_at.strftime('%Y-%m-%d')
          daily_counts[day] += 1
        end

        {
          total_sessions: sessions.length,
          status_counts: status_counts,
          agent_usage: agent_counts,
          daily_sessions: daily_counts,
          total_duration_hours: (total_duration / 3600).round(2),
          avg_duration_minutes: durations.empty? ? 0 : ((durations.sum / durations.length) / 60).round(2),
          oldest_session: sessions.values.map { |s| s['startedAt'] }.min,
          newest_session: sessions.values.map { |s| s['startedAt'] }.max
        }
      end

      def display_stats(stats)
        puts "=== GMUX Session Statistics ==="
        puts
        puts "Total Sessions: #{stats[:total_sessions]}"
        puts "Total Duration: #{stats[:total_duration_hours]} hours"
        puts "Avg Duration: #{stats[:avg_duration_minutes]} minutes"
        puts
        puts "Status Breakdown:"
        stats[:status_counts].each do |status, count|
          puts "  #{status}: #{count}"
        end
        puts
        puts "Agent Usage:"
        stats[:agent_usage].sort_by { |_, v| -v }.each do |agent, count|
          puts "  #{agent}: #{count}"
        end
        puts
        puts "Daily Sessions (last 7 days):"
        stats[:daily_sessions].sort.last(7).each do |day, count|
          puts "  #{day}: #{count}"
        end
        puts
        puts "Session Range:"
        puts "  Oldest: #{stats[:oldest_session]}"
        puts "  Newest: #{stats[:newest_session]}"
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

    opts.on('-d', '--detailed', "Show detailed statistics") do
      options[:detailed] = true
    end

    opts.on('-j', '--json', "Output as JSON") do
      options[:json] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::SessionStats.new(options).run
end
