#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

module Gmux
  module Scripts
    class Restore
      GMUX_DIR = File.join(Dir.home, '.gmux')
      BACKUP_DIR = File.join(GMUX_DIR, 'backups')

      def initialize(options = {})
        @dry_run = options[:dry_run] || false
        @verbose = options[:verbose] || false
        @force = options[:force] || false
        @backup_name = options[:backup_name]
        @list_only = options[:list_only] || false
        @restore_file = options[:restore_file]
      end

      def run
        puts "=== GMUX Restore ==="
        puts

        if @list_only
          list_backups
          return
        end

        if @restore_file
          restore_from_file(@restore_file)
          return
        end

        # Find backup to restore
        backup_path = find_backup
        return unless backup_path

        # Load manifest
        manifest = load_manifest(backup_path)
        if manifest.nil?
          puts "Error: Invalid backup (no manifest.json)"
          return
        end

        display_backup_info(manifest)

        if @dry_run
          puts "[DRY RUN] Would restore from: #{File.basename(backup_path)}"
          return
        end

        unless @force
          print "Restore from #{File.basename(backup_path)}? This will overwrite current config. [y/N] "
          return unless STDIN.gets.chomp.downcase == 'y'
        end

        # Restore files
        restore_files(backup_path, manifest)
        restore_dirs(backup_path, manifest)

        puts
        puts "Restore complete!"
      end

      private

      def list_backups
        backups = Dir.glob(File.join(BACKUP_DIR, 'gmux_backup_*'))
                     .sort_by { |f| File.mtime(f) }
                     .reverse

        if backups.empty?
          puts "No backups found in #{BACKUP_DIR}"
          return
        end

        puts "Available backups:"
        puts
        backups.each do |backup|
          name = File.basename(backup)
          time = File.mtime(backup).strftime('%Y-%m-%d %H:%M:%S')
          size = format_size(dir_size(backup))
          puts "  #{name}"
          puts "    Time: #{time}"
          puts "    Size: #{size}"
          puts
        end
      end

      def find_backup
        if @backup_name
          # Find specific backup
          backup_path = if @backup_name.start_with?('gmux_backup_')
                          File.join(BACKUP_DIR, @backup_name)
                        else
                          File.join(BACKUP_DIR, "gmux_backup_#{@backup_name}")
                        end

          unless File.directory?(backup_path)
            # Try with .tar.gz extension
            tar_file = "#{backup_path}.tar.gz"
            if File.exist?(tar_file)
              puts "Extracting compressed backup..."
              extract_backup(tar_file)
              backup_path = backup_path
            else
              puts "Error: Backup not found: #{@backup_name}"
              return nil
            end
          end

          backup_path
        else
          # Find latest backup
          backups = Dir.glob(File.join(BACKUP_DIR, 'gmux_backup_*'))
                       .sort_by { |f| File.mtime(f) }
                       .reverse

          if backups.empty?
            puts "Error: No backups found"
            puts "Create one first with: gmux scripts backup"
            return nil
          end

          backups.first
        end
      end

      def extract_backup(tar_file)
        Dir.chdir(BACKUP_DIR) do
          system("tar -xzf #{tar_file}")
        end
      end

      def load_manifest(backup_path)
        manifest_path = File.join(backup_path, 'manifest.json')
        return nil unless File.exist?(manifest_path)

        JSON.parse(File.read(manifest_path))
      rescue JSON::ParserError
        nil
      end

      def display_backup_info(manifest)
        puts "Backup info:"
        puts "  Time: #{manifest['timestamp']}"
        puts "  Version: #{manifest['version']}"
        puts "  Files: #{manifest['files'].length}"
        puts "  Dirs: #{manifest['dirs'].length}"
        puts
      end

      def restore_files(backup_path, manifest)
        manifest['files'].each do |file|
          source = File.join(backup_path, file)
          dest = File.join(GMUX_DIR, file)

          next unless File.exist?(source)

          FileUtils.mkdir_p(File.dirname(dest))
          FileUtils.cp(source, dest)
          puts "  Restored: #{file}" if @verbose
        end
      end

      def restore_dirs(backup_path, manifest)
        manifest['dirs'].each do |dir|
          source = File.join(backup_path, dir)
          dest = File.join(GMUX_DIR, dir)

          next unless File.directory?(source)

          FileUtils.rm_rf(dest) if File.directory?(dest)
          FileUtils.cp_r(source, dest)
          puts "  Restored: #{dir}/" if @verbose
        end
      end

      def restore_from_file(file_path)
        unless File.exist?(file_path)
          puts "Error: File not found: #{file_path}"
          return
        end

        puts "Restoring from: #{file_path}"

        if @dry_run
          puts "[DRY RUN] Would restore from file"
          return
        end

        unless @force
          print "Restore from #{file_path}? This will overwrite current config. [y/N] "
          return unless STDIN.gets.chomp.downcase == 'y'
        end

        # Determine file type
        if file_path.end_with?('.tar.gz')
          # Extract and restore
          Dir.mktmpdir do |tmpdir|
            system("tar -xzf #{file_path} -C #{tmpdir}")
            backup_dir = Dir.glob(File.join(tmpdir, 'gmux_backup_*')).first
            if backup_dir
              manifest = load_manifest(backup_dir)
              if manifest
                restore_files(backup_dir, manifest)
                restore_dirs(backup_dir, manifest)
              end
            end
          end
        elsif File.directory?(file_path)
          # Direct directory restore
          manifest = load_manifest(file_path)
          if manifest
            restore_files(file_path, manifest)
            restore_dirs(file_path, manifest)
          else
            puts "Error: Invalid backup directory (no manifest.json)"
          end
        else
          puts "Error: Unsupported file format"
          return
        end

        puts
        puts "Restore complete!"
      end

      def dir_size(path)
        total = 0
        Dir.glob(File.join(path, '**', '*')).each do |file|
          total += File.size(file) if File.file?(file)
        end
        total
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
    opts.banner = "Usage: #{$PROGRAM_NAME} [options] [backup_name]"

    opts.on('-l', '--list', "List available backups") do
      options[:list_only] = true
    end

    opts.on('-f', '--file FILE', "Restore from specific file") do |f|
      options[:restore_file] = f
    end

    opts.on('-n', '--dry-run', "Show what would be restored") do
      options[:dry_run] = true
    end

    opts.on('-y', '--force', "Skip confirmation prompt") do
      options[:force] = true
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  options[:backup_name] = ARGV.shift
  Gmux::Scripts::Restore.new(options).run
end
