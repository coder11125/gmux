#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class Diagnostics
      GMUX_DIR = File.join(Dir.home, '.gmux')
      STORE_PATH = File.join(GMUX_DIR, 'sessions.json')

      def initialize(options = {})
        @verbose = options[:verbose] || false
        @json_output = options[:json] || false
        @fix = options[:fix] || false
      end

      def run
        results = {
          timestamp: Time.now.iso8601,
          system: check_system,
          dependencies: check_dependencies,
          tmux: check_tmux,
          git: check_git,
          gmux: check_gmux,
          sessions: check_sessions,
          issues: []
        }

        # Collect issues
        results[:issues] = collect_issues(results)

        if @json_output
          puts JSON.pretty_generate(results)
        else
          display_results(results)
        end
      end

      private

      def check_system
        {
          os: RbConfig::CONFIG['host_os'],
          ruby: RUBY_VERSION,
          shell: ENV['SHELL'],
          home: Dir.home,
          user: ENV['USER']
        }
      end

      def check_dependencies
        deps = {}

        # Check ruby
        deps[:ruby] = {
          installed: system('which ruby > /dev/null 2>&1'),
          version: `ruby --version 2>/dev/null`.chomp
        }

        # Check git
        deps[:git] = {
          installed: system('which git > /dev/null 2>&1'),
          version: `git --version 2>/dev/null`.chomp
        }

        # Check tmux
        deps[:tmux] = {
          installed: system('which tmux > /dev/null 2>&1'),
          version: `tmux -V 2>/dev/null`.chomp
        }

        # Check bun
        deps[:bun] = {
          installed: system('which bun > /dev/null 2>&1'),
          version: `bun --version 2>/dev/null`.chomp
        }

        # Check node (optional)
        deps[:node] = {
          installed: system('which node > /dev/null 2>&1'),
          version: `node --version 2>/dev/null`.chomp
        }

        deps
      end

      def check_tmux
        info = {
          server_running: system('tmux list-sessions > /dev/null 2>&1'),
          sessions: []
        }

        if info[:server_running]
          output = `tmux list-sessions 2>/dev/null`
          info[:sessions] = output.split("\n").map do |line|
            parts = line.split(':')
            { name: parts[0], windows: parts[1]&.to_i }
          end
        end

        info
      end

      def check_git
        info = {
          configured: system('git config user.name > /dev/null 2>&1'),
          user_name: `git config user.name 2>/dev/null`.chomp,
          user_email: `git config user.email 2>/dev/null`.chomp,
          default_branch: `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null`.chomp.gsub('refs/remotes/origin/', '')
        }

        info
      end

      def check_gmux
        info = {
          config_dir: File.directory?(GMUX_DIR),
          config_file: File.exist?(File.join(GMUX_DIR, 'config.json')),
          sessions_file: File.exist?(STORE_PATH),
          logs_dir: File.directory?(File.join(GMUX_DIR, 'logs')),
          plugins_dir: File.directory?(File.join(GMUX_DIR, 'plugins')),
          backups_dir: File.directory?(File.join(GMUX_DIR, 'backups'))
        }

        # Check config file validity
        if info[:config_file]
          config_path = File.join(GMUX_DIR, 'config.json')
          begin
            JSON.parse(File.read(config_path))
            info[:config_valid] = true
          rescue JSON::ParserError
            info[:config_valid] = false
          end
        end

        # Check sessions file validity
        if info[:sessions_file]
          begin
            sessions = JSON.parse(File.read(STORE_PATH))
            info[:session_count] = sessions.length
            info[:sessions_valid] = true
          rescue JSON::ParserError
            info[:sessions_valid] = false
          end
        end

        info
      end

      def check_sessions
        return { exists: false } unless File.exist?(STORE_PATH)

        begin
          sessions = JSON.parse(File.read(STORE_PATH))
          {
            exists: true,
            count: sessions.length,
            running: sessions.values.count { |s| s['status'] == 'running' },
            complete: sessions.values.count { |s| s['status'] == 'complete' },
            error: sessions.values.count { |s| s['status'] == 'error' }
          }
        rescue JSON::ParserError
          { exists: true, valid: false }
        end
      end

      def collect_issues(results)
        issues = []

        # Check dependencies
        %w[git tmux ruby bun].each do |dep|
          unless results[:dependencies][dep.to_sym][:installed]
            issues << {
              severity: 'error',
              message: "#{dep} is not installed",
              fix: "Install #{dep}"
            }
          end
        end

        # Check tmux server
        unless results[:tmux][:server_running]
          issues << {
            severity: 'warning',
            message: 'tmux server is not running',
            fix: 'Start tmux with: tmux'
          }
        end

        # Check git config
        unless results[:git][:configured]
          issues << {
            severity: 'warning',
            message: 'git user not configured',
            fix: 'Set with: git config --global user.name "Your Name"'
          }
        end

        # Check gmux config
        unless results[:gmux][:config_dir]
          issues << {
            severity: 'info',
            message: 'gmux config directory not found',
            fix: 'Create with: mkdir -p ~/.gmux'
          }
        end

        if results[:gmux][:config_file] && !results[:gmux][:config_valid]
          issues << {
            severity: 'error',
            message: 'gmux config file is invalid JSON',
            fix: 'Fix or delete: ~/.gmux/config.json'
          }
        end

        if results[:gmux][:sessions_file] && !results[:gmux][:sessions_valid]
          issues << {
            severity: 'error',
            message: 'gmux sessions file is invalid JSON',
            fix: 'Fix or delete: ~/.gmux/sessions.json'
          }
        end

        issues
      end

      def display_results(results)
        puts "=== GMUX Diagnostics ==="
        puts "Time: #{results[:timestamp]}"
        puts

        # System
        puts "System:"
        puts "  OS: #{results[:system][:os]}"
        puts "  Ruby: #{results[:system][:ruby]}"
        puts "  User: #{results[:system][:user]}"
        puts

        # Dependencies
        puts "Dependencies:"
        results[:dependencies].each do |name, info|
          status = info[:installed] ? "✓" : "✗"
          version = info[:version] || 'not found'
          puts "  #{status} #{name}: #{version}"
        end
        puts

        # tmux
        puts "tmux:"
        puts "  Server: #{results[:tmux][:server_running] ? 'running' : 'not running'}"
        if results[:tmux][:sessions].any?
          results[:tmux][:sessions].each do |session|
            puts "    - #{session[:name]} (#{session[:windows]} windows)"
          end
        end
        puts

        # Git
        puts "Git:"
        puts "  Configured: #{results[:git][:configured] ? 'yes' : 'no'}"
        puts "  User: #{results[:git][:user_name]} <#{results[:git][:user_email]}>"
        puts "  Default branch: #{results[:git][:default_branch] || 'not set'}"
        puts

        # gmux
        puts "gmux:"
        puts "  Config dir: #{results[:gmux][:config_dir] ? 'exists' : 'missing'}"
        puts "  Config file: #{results[:gmux][:config_file] ? 'exists' : 'missing'}"
        puts "  Sessions file: #{results[:gmux][:sessions_file] ? 'exists' : 'missing'}"
        if results[:gmux][:session_count]
          puts "  Sessions: #{results[:gmux][:session_count]}"
        end
        puts

        # Sessions
        if results[:sessions][:exists]
          puts "Sessions:"
          puts "  Total: #{results[:sessions][:count]}"
          puts "  Running: #{results[:sessions][:running]}"
          puts "  Complete: #{results[:sessions][:complete]}"
          puts "  Error: #{results[:sessions][:error]}"
          puts
        end

        # Issues
        if results[:issues].empty?
          puts "No issues found!"
        else
          puts "Issues (#{results[:issues].length}):"
          results[:issues].each_with_index do |issue, i|
            puts "  #{i + 1}. #{issue[:severity].upcase}: #{issue[:message]}"
            puts "     Fix: #{issue[:fix]}" if @verbose
          end
        end
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-v', '--verbose', "Show fix suggestions") do
      options[:verbose] = true
    end

    opts.on('-j', '--json', "Output as JSON") do
      options[:json] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::Diagnostics.new(options).run
end
