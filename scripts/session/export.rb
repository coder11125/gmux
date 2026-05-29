#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class SessionExport
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')

      def initialize(options = {})
        @session_name = options[:session_name]
        @output_format = options[:format] || 'json'
        @output_file = options[:output_file]
        @all = options[:all] || false
        @verbose = options[:verbose] || false
      end

      def run
        puts "=== GMUX Session Export ==="
        puts

        sessions = load_sessions
        if sessions.empty?
          puts "No sessions found."
          return
        end

        if @all
          export_sessions(sessions)
        elsif @session_name
          session = sessions[@session_name]
          if session.nil?
            puts "Session '#{@session_name}' not found."
            return
          end
          export_session(@session_name, session)
        else
          puts "Specify a session name or use --all"
          return
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

      def export_sessions(sessions)
        export_data = sessions.map { |name, session| export_session_data(name, session) }
        write_export(export_data)
      end

      def export_session(name, session)
        export_data = export_session_data(name, session)
        write_export(export_data)
      end

      def export_session_data(name, session)
        {
          name: name,
          branch: session['branchName'],
          worktree: session['worktreePath'],
          agent: session['agentCommand'],
          status: session['status'],
          started: session['startedAt'],
          exported_at: Time.now.iso8601
        }
      end

      def write_export(data)
        case @output_format
        when 'json'
          output = JSON.pretty_generate(data)
        when 'yaml'
          output = to_yaml(data)
        when 'toml'
          output = to_toml(data)
        else
          puts "Unknown format: #{@output_format}"
          return
        end

        if @output_file
          File.write(@output_file, output)
          puts "Exported to: #{@output_file}"
        else
          puts output
        end
      end

      def to_yaml(data)
        require 'yaml'
        data.to_yaml
      end

      def to_toml(data)
        lines = []
        Array(data).each do |item|
          lines << "[[session]]"
          item.each do |key, value|
            lines << "#{key} = \"#{value}\""
          end
          lines << ""
        end
        lines.join("\n")
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options] [session_name]"

    opts.on('-a', '--all', "Export all sessions") do
      options[:all] = true
    end

    opts.on('-f', '--format FORMAT', %w[json yaml toml], "Output format (json, yaml, toml)") do |f|
      options[:format] = f
    end

    opts.on('-o', '--output FILE', "Write to file instead of stdout") do |o|
      options[:output_file] = o
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  options[:session_name] = ARGV.shift
  Gmux::Scripts::SessionExport.new(options).run
end
