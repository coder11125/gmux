#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class ConflictHelper
      def initialize(options = {})
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @auto_resolve = options[:auto_resolve]
        @worktree = options[:worktree] || Dir.pwd
      end

      def run
        puts "=== GMUX Conflict Helper ==="
        puts "Worktree: #{@worktree}"
        puts

        unless git_repository?
          puts "Error: Not a git repository"
          return
        end

        conflicts = get_conflicts
        if conflicts.empty?
          puts "No merge conflicts found."
          return
        end

        puts "Found #{conflicts.length} conflicted file(s):"
        conflicts.each_with_index do |conflict, i|
          puts "  #{i + 1}. #{conflict[:file]}"
          puts "     Status: #{conflict[:status]}"
          puts "     Markers: #{conflict[:markers]} conflict(s)"
        end
        puts

        if @dry_run
          puts "[DRY RUN] Would resolve #{conflicts.length} conflict(s)"
          return
        end

        # Auto-resolve if specified
        if @auto_resolve
          auto_resolve_conflicts(conflicts)
          return
        end

        # Interactive resolution
        interactive_resolve(conflicts)
      end

      private

      def git_repository?
        system("git rev-parse --git-dir > /dev/null 2>&1", chdir: @worktree)
      end

      def get_conflicts
        output = `git status --porcelain`.chomp
        lines = output.split("\n").reject(&:empty?)

        conflicts = []
        lines.each do |line|
          next unless line.match?(/^(UU|AA|DU|UD|AA)/)

          file = line[3..]
          status = line[0..1]
          markers = count_conflict_markers(file)

          conflicts << {
            file: file,
            status: conflict_status(status),
            markers: markers
          }
        end

        conflicts
      end

      def conflict_status(code)
        case code
        when 'UU' then 'both modified'
        when 'AA' then 'both added'
        when 'DU' then 'deleted by us'
        when 'UD' then 'deleted by them'
        else 'unknown'
        end
      end

      def count_conflict_markers(file)
        return 0 unless File.exist?(file)

        content = File.read(file)
        content.scan(/^<{7}/).length
      end

      def auto_resolve_conflicts(conflicts)
        puts "Auto-resolving conflicts..."
        resolved = 0

        conflicts.each do |conflict|
          case @auto_resolve
          when 'ours'
            resolve_with_ours(conflict[:file])
            resolved += 1
          when 'theirs'
            resolve_with_theirs(conflict[:file])
            resolved += 1
          when 'both'
            resolve_with_both(conflict[:file])
            resolved += 1
          else
            puts "  Skipping #{conflict[:file]} (unknown strategy: #{@auto_resolve})"
            next
          end
          puts "  Resolved: #{conflict[:file]} (using #{@auto_resolve})"
        end

        if resolved > 0
          stage_resolved_files
          puts "Staged #{resolved} resolved file(s)."
        end
      end

      def resolve_with_ours(file)
        system("git checkout --ours #{file}", chdir: @worktree)
      end

      def resolve_with_theirs(file)
        system("git checkout --theirs #{file}", chdir: @worktree)
      end

      def resolve_with_both(file)
        # Keep both versions with markers
        content = File.read(file)
        # Remove conflict markers but keep content
        resolved = content
          .gsub(/^={7}\n/, '')
          .gsub(/^>{7}\n/, '')
          .gsub(/^<{7}\n/, '')
        File.write(file, resolved)
      end

      def stage_resolved_files
        system("git add -u", chdir: @worktree)
      end

      def interactive_resolve(conflicts)
        conflicts.each_with_index do |conflict, i|
          puts "Resolving #{i + 1}/#{conflicts.length}: #{conflict[:file]}"
          puts "  Markers: #{conflict[:markers]}"
          puts
          puts "  Options:"
          puts "    [o] Keep ours"
          puts "    [t] Keep theirs"
          puts "    [b] Keep both"
          puts "    [e] Edit manually"
          puts "    [s] Skip"
          print "  Choice: "

          choice = STDIN.gets.chomp.downcase

          case choice
          when 'o'
            resolve_with_ours(conflict[:file])
            puts "  Resolved: using ours"
          when 't'
            resolve_with_theirs(conflict[:file])
            puts "  Resolved: using theirs"
          when 'b'
            resolve_with_both(conflict[:file])
            puts "  Resolved: keeping both"
          when 'e'
            puts "  Opening editor..."
            system("${EDITOR:-vim} #{conflict[:file]}", chdir: @worktree)
            print "  Stage file? [Y/n] "
            stage = STDIN.gets.chomp.downcase
            system("git add #{conflict[:file]}", chdir: @worktree) unless stage == 'n'
          when 's'
            puts "  Skipped"
            next
          else
            puts "  Invalid choice, skipping"
            next
          end
          puts
        end
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-a', '--auto-resolve STRATEGY', %w[ours theirs both],
            "Auto-resolve with strategy (ours, theirs, both)") do |a|
      options[:auto_resolve] = a
    end

    opts.on('-w', '--worktree PATH', "Worktree path (default: current directory)") do |w|
      options[:worktree] = w
    end

    opts.on('-n', '--dry-run', "Show what would be resolved") do
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

  Gmux::Scripts::ConflictHelper.new(options).run
end
