/**
 * Logging utility wrapping VS Code OutputChannel
 */

import * as vscode from "vscode";

/**
 * Logger wrapper for OutputChannel with timestamp prefixes
 */
export class Logger {
	private channel: vscode.OutputChannel | null = null;
	private readonly channelName: string;

	private constructor(channelName: string) {
		this.channelName = channelName;
	}

	/**
	 * Create a new Logger instance
	 * @param name Name for the output channel
	 * @returns Logger instance
	 */
	static create(name: string): Logger {
		return new Logger(name);
	}

	/**
	 * Lazy initialization of OutputChannel
	 */
	private getChannel(): vscode.OutputChannel {
		if (!this.channel) {
			this.channel = vscode.window.createOutputChannel(this.channelName);
		}
		return this.channel;
	}

	/**
	 * Format a message with timestamp
	 */
	private format(level: string, message: string): string {
		const timestamp = new Date().toISOString();
		return `[${timestamp}] [${level}] ${message}`;
	}

	/**
	 * Log an informational message
	 */
	info(message: string): void {
		this.getChannel().appendLine(this.format("INFO", message));
	}

	/**
	 * Log a warning message
	 */
	warn(message: string): void {
		this.getChannel().appendLine(this.format("WARN", message));
	}

	/**
	 * Log an error message
	 */
	error(message: string, error?: Error): void {
		let msg = message;
		if (error) {
			msg += `: ${error.message}`;
			if (error.stack) {
				msg += `\n${error.stack}`;
			}
		}
		this.getChannel().appendLine(this.format("ERROR", msg));
	}

	/**
	 * Show the output channel (makes it visible to user)
	 */
	show(): void {
		this.getChannel().show();
	}

	/**
	 * Dispose of the output channel
	 */
	dispose(): void {
		if (this.channel) {
			this.channel.dispose();
			this.channel = null;
		}
	}
}
