#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'optparse'
require 'net/http'
require 'uri'

module Gmux
  module Scripts
    class Notifier
      STORE_PATH = File.join(Dir.home, '.gmux', 'sessions.json')

      def initialize(options = {})
        @interval = options[:interval] || 5
        @verbose = options[:verbose] || false
        @webhook = options[:webhook]
        @email = options[:email]
        @slack = options[:slack]
        @discord = options[:discord]
        @telegram = options[:telegram]
        @sound = options[:sound] || false
        @watch_session = options[:session]
        @notify_on = options[:notify_on] || ['complete', 'error']
      end

      def run
        puts "=== GMUX Session Notifier ==="
        puts "Interval: #{@interval}s"
        puts "Notify on: #{@notify_on.join(', ')}"
        puts "Methods: #{notification_methods.join(', ')}"
        puts

        watch_sessions
      end

      private

      def notification_methods
        methods = []
        methods << 'webhook' if @webhook
        methods << 'email' if @email
        methods << 'slack' if @slack
        methods << 'discord' if @discord
        methods << 'telegram' if @telegram
        methods << 'sound' if @sound
        methods << 'stdout' if methods.empty?
        methods
      end

      def load_sessions
        return {} unless File.exist?(STORE_PATH)
        JSON.parse(File.read(STORE_PATH))
      rescue JSON::ParserError
        {}
      end

      def watch_sessions
        puts "Watching for session completion... (Ctrl+C to stop)"
        puts

        running = true
        trap("INT") { running = false }

        @last_status = {}

        while running
          sessions = load_sessions
          sessions_to_watch = @watch_session ?
            sessions.select { |name, _| name == @watch_session } :
            sessions

          sessions_to_watch.each do |name, session|
            current_status = session['status']
            last_status = @last_status[name]

            # Check if status changed to a notify-worthy status
            if last_status && last_status != current_status && @notify_on.include?(current_status)
              notify(name, session, last_status)
            end

            @last_status[name] = current_status
          end

          sleep @interval
        end

        puts "\nStopped watching."
      end

      def notify(session_name, session, previous_status)
        message = build_message(session_name, session, previous_status)

        puts if @verbose
        puts "  Notification: #{session_name} is now #{session['status']}" if @verbose

        # Send notifications via all configured methods
        send_webhook(message) if @webhook
        send_email(message) if @email
        send_slack(message) if @slack
        send_discord(message) if @discord
        send_telegram(message) if @telegram
        play_sound if @sound

        # Always print to stdout if no other method configured
        unless @webhook || @email || @slack || @discord || @telegram
          display_notification(message)
        end
      end

      def build_message(session_name, session, previous_status)
        {
          session: session_name,
          status: session['status'],
          previous_status: previous_status,
          agent: session['agentCommand'],
          branch: session['branchName'],
          worktree: session['worktreePath'],
          started: session['startedAt'],
          timestamp: Time.now.iso8601
        }
      end

      def display_notification(message)
        puts
        puts "=" * 50
        puts "SESSION NOTIFICATION"
        puts "=" * 50
        puts "Session: #{message[:session]}"
        puts "Status: #{message[:status].upcase}"
        puts "Previous: #{message[:previous_status]}"
        puts "Agent: #{message[:agent]}"
        puts "Branch: #{message[:branch]}"
        puts "Time: #{message[:timestamp]}"
        puts "=" * 50
      end

      def send_webhook(message)
        uri = URI.parse(@webhook)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = (uri.scheme == 'https')

        request = Net::HTTP::Post.new(uri.path, { 'Content-Type' => 'application/json' })
        request.body = {
          text: "GMUX Session #{message[:status].upcase}",
          session: message[:session],
          status: message[:status],
          agent: message[:agent],
          timestamp: message[:timestamp]
        }.to_json

        begin
          response = http.request(request)
          puts "  Webhook sent: #{response.code}" if @verbose
        rescue StandardError => e
          puts "  Webhook error: #{e.message}"
        end
      end

      def send_email(message)
        # Basic email using mail command (if available)
        subject = "GMUX: #{message[:session]} is #{message[:status]}"
        body = <<~BODY
          Session: #{message[:session]}
          Status: #{message[:status]}
          Agent: #{message[:agent]}
          Branch: #{message[:branch]}
          Time: #{message[:timestamp]}
        BODY

        if @email.include?('@')
          # Send to email address
          system("echo '#{body}' | mail -s '#{subject}' #{@email}")
          puts "  Email sent to: #{@email}" if @verbose
        else
          # Use as mail command
          system("echo '#{body}' | #{@email} -s '#{subject}'")
          puts "  Email sent via: #{@email}" if @verbose
        end
      end

      def send_slack(message)
        slack_webhook = @slack
        uri = URI.parse(slack_webhook)

        payload = {
          text: "GMUX Session #{message[:status].upcase}",
          attachments: [
            {
              color: message[:status] == 'complete' ? 'good' : 'danger',
              fields: [
                { title: 'Session', value: message[:session], short: true },
                { title: 'Status', value: message[:status], short: true },
                { title: 'Agent', value: message[:agent], short: true },
                { title: 'Branch', value: message[:branch], short: true }
              ],
              timestamp: Time.now.to_i
            }
          ]
        }

        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = (uri.scheme == 'https')
        request = Net::HTTP::Post.new(uri.path, { 'Content-Type' => 'application/json' })
        request.body = payload.to_json

        begin
          response = http.request(request)
          puts "  Slack sent: #{response.code}" if @verbose
        rescue StandardError => e
          puts "  Slack error: #{e.message}"
        end
      end

      def send_discord(message)
        discord_webhook = @discord
        uri = URI.parse(discord_webhook)

        payload = {
          content: "GMUX Session #{message[:status].upcase}",
          embeds: [
            {
              title: "Session #{message[:status].capitalize}",
              description: "Session `#{message[:session]}` has #{message[:status]}.",
              color: message[:status] == 'complete' ? 0x00ff00 : 0xff0000,
              fields: [
                { name: 'Agent', value: message[:agent], inline: true },
                { name: 'Branch', value: message[:branch], inline: true },
                { name: 'Time', value: message[:timestamp], inline: false }
              ]
            }
          ]
        }

        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = (uri.scheme == 'https')
        request = Net::HTTP::Post.new(uri.path, { 'Content-Type' => 'application/json' })
        request.body = payload.to_json

        begin
          response = http.request(request)
          puts "  Discord sent: #{response.code}" if @verbose
        rescue StandardError => e
          puts "  Discord error: #{e.message}"
        end
      end

      def send_telegram(message)
        telegram_bot, chat_id = @telegram.split(':')
        return unless telegram_bot && chat_id

        uri = URI.parse("https://api.telegram.org/bot#{telegram_bot}/sendMessage")

        text = <<~TEXT
          *GMUX Session #{message[:status].upcase}*
          
          Session: #{message[:session]}
          Status: #{message[:status]}
          Agent: #{message[:agent]}
          Branch: #{message[:branch]}
          Time: #{message[:timestamp]}
        TEXT

        payload = {
          chat_id: chat_id,
          text: text,
          parse_mode: 'Markdown'
        }

        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        request = Net::HTTP::Post.new(uri.path, { 'Content-Type' => 'application/json' })
        request.body = payload.to_json

        begin
          response = http.request(request)
          puts "  Telegram sent: #{response.code}" if @verbose
        rescue StandardError => e
          puts "  Telegram error: #{e.message}"
        end
      end

      def play_sound
        # Play a notification sound (macOS)
        if system('which afplay > /dev/null 2>&1')
          system('afplay /System/Library/Sounds/Glass.aiff')
        elsif system('which aplay > /dev/null 2>&1')
          system('aplay /usr/share/sounds/freedesktop/stereo/complete.oga')
        end
      end
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  options = {}
  OptionParser.new do |opts|
    opts.banner = "Usage: #{$PROGRAM_NAME} [options]"

    opts.on('-i', '--interval SECONDS', Integer, "Check interval in seconds (default: 5)") do |i|
      options[:interval] = i
    end

    opts.on('-s', '--session NAME', "Watch specific session") do |s|
      options[:session] = s
    end

    opts.on('-w', '--webhook URL', "Send webhook notification") do |w|
      options[:webhook] = w
    end

    opts.on('--slack URL', "Send Slack notification") do |s|
      options[:slack] = s
    end

    opts.on('--discord URL', "Send Discord notification") do |d|
      options[:discord] = d
    end

    opts.on('--telegram BOT:CHAT_ID', "Send Telegram notification") do |t|
      options[:telegram] = t
    end

    opts.on('-e', '--email ADDRESS', "Send email notification") do |e|
      options[:email] = e
    end

    opts.on('--sound', "Play sound on notification") do
      options[:sound] = true
    end

    opts.on('-n', '--notify-on STATUS', Array, "Notify on status (default: complete,error)") do |n|
      options[:notify_on] = n
    end

    opts.on('-v', '--verbose', "Show detailed output") do
      options[:verbose] = true
    end

    opts.on('-h', '--help', "Show this help") do
      puts opts
      exit
    end
  end.parse!

  Gmux::Scripts::Notifier.new(options).run
end
