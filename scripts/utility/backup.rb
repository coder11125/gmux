#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'
require 'zlib'

module Gmux
  module Scripts
    class Backup
      GMUX_DIR = File.join(Dir.home, '.gmux')
      BACKUP_DIR = File.join(GMUX_DIR, 'backups')

      FILES_TO_BACKUP = [
        'sessions.json',
        'config.json',
        '.gmuxrc'
      ].freeze

      DIRS_TO_BACKUP = [
        'logs',
        'plugins'
      ].freeze

      def initialize(options = {})
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @compress = options[:compress] || false
        @output_dir = options[:output_dir] || BACKUP_DIR
        @keep_count = options[:keep_count] || 5
      end

      def run
        puts "=== GMUX Backup ==="
        puts "Output: #{@output_dir}"
        puts "Compress: #{@compress}"
        puts

        ensure_backup_dir

        timestamp = Time.now.strftime('%Y%m%d_%H%M%S')
        backup_name = "gmux_backup_#{timestamp}"
        backup_path = File.join(@output_dir, backup_name)

        if @dry_run
          puts "[DRY RUN] Would create backup:"
          display_backup_contents
          return
        end

        # Create backup directory
        FileUtils.mkdir_p(backup_path)

        # Backup files
        backed_up_files = backup_files(backup_path)
        backed_up_dirs = backup_dirs(backup_path)

        # Create manifest
        create_manifest(backup_path, backed_up_files, backed_up_dirs)

        # Compress if requested
        if @compress
          compressed_path = compress_backup(backup_path)
          puts
          puts "Backup created: #{compressed_path}"
          puts "Size: #{format_size(File.size(compressed_path))}"
        else
          puts
          puts "Backup created: #{backup_path}"
          puts "Files: #{backed_up_files.length}"
          puts "Dirs: #{backed_up_dirs.length}"
        end

        # Cleanup old backups
        cleanup_old_backups
      end

      private

      def ensure_backup_dir
        FileUtils.mkdir_p(@output_dir)
      end

      def backup_files(backup_path)
        backed_up = []

        FILES_TO_BACKUP.each do |file|
          source = File.join(GMUX_DIR, file)
          next unless File.exist?(source)

          dest = File.join(backup_path, file)
          FileUtils.mkdir_p(File.dirname(dest))
          FileUtils.cp(source, dest)
          backed_up << file
          puts "  Backed up: #{file}" if @verbose
        end

        # Also backup .gmuxrc from current directory
        local_gmuxrc = '.gmuxrc'
        if File.exist?(local_gmuxrc)
          dest = File.join(backup_path, '.gmuxrc')
          FileUtils.cp(local_gmuxrc, dest)
          backed_up << '.gmuxrc'
          puts "  Backed up: .gmuxrc (local)" if @verbose
        end

        backed_up
      end

      def backup_dirs(backup_path)
        backed_up = []

        DIRS_TO_BACKUP.each do |dir|
          source = File.join(GMUX_DIR, dir)
          next unless File.directory?(source)

          dest = File.join(backup_path, dir)
          FileUtils.cp_r(source, dest)
          backed_up << dir
          puts "  Backed up: #{dir}/" if @verbose
        end

        backed_up
      end

      def create_manifest(backup_path, files, dirs)
        manifest = {
          timestamp: Time.now.iso8601,
          version: '1.0',
          files: files,
          dirs: dirs,
          gmux_dir: GMUX_DIR
        }

        manifest_path = File.join(backup_path, 'manifest.json')
        File.write(manifest_path, JSON.pretty_generate(manifest))
        puts "  Created: manifest.json" if @verbose
      end

      def compress_backup(backup_path)
        tar_file = "#{backup_path}.tar.gz"
        system("tar -czf #{tar_file} -C #{File.dirname(backup_path)} #{File.basename(backup_path)}")
        FileUtils.rm_rf(backup_path)
        tar_file
      end

      def cleanup_old_backups
        backups = Dir.glob(File.join(@output_dir, 'gmux_backup_*'))
                     .map { |f| File.mtime(f) }
                     .sort

        return if backups.length <= @keep_count

        to_delete = backups[0...backups.length - @keep_count]
        to_delete.each do |mtime|
          backup = Dir.glob(File.join(@output_dir, "gmux_backup_*"))
                      .find { |f| File.mtime(f) == mtime }
          next unless backup

          FileUtils.rm_rf(backup)
          puts "  Cleaned up: #{File.basename(backup)}" if @verbose
        end
      end

      def display_backup_contents
        puts "  Files:"
        FILES_TO_BACKUP.each do |file|
          source = File.join(GMUX_DIR, file)
          status = File.exist?(source) ? "exists" : "missing"
          puts "    - #{file} (#{status})"
        end
        puts "  Dirs:"
        DIRS_TO_BACKUP.each do |dir|
          source = File.join(GMUX_DIR, dir)
          status = File.directory?(source) ? "exists" : "missing"
          puts "    - #{dir}/ (#{status})"
        end
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

    opts.on('-o', '--output-dir DIR', "Backup output directory") do |o|
      options[:output_dir] = o
    end

    opts.on('-k', '--keep-count N', Integer, "Number of backups to keep (default: 5)") do |k|
      options[:keep_count] = k
    end

    opts.on('-z', '--compress', "Compress backup with gzip") do
      options[:compress] = true
    end

    opts.on('-n', '--dry-run', "Show what would be backed up") do
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

  Gmux::Scripts::Backup.new(options).run
end
