/**
 * Root React component for the Claude Usage dashboard.
 * Manages tab navigation, data fetching, and message handling.
 */
import { useEffect, useState } from "react";
import { OverviewTab } from "./components/OverviewTab";
import { ProjectsTab } from "./components/ProjectsTab";
import { SessionTab } from "./components/SessionTab";
import { TrendsTab } from "./components/TrendsTab";
import { TrustIndicator } from "./components/TrustIndicator";
import { WelcomeCard } from "./components/WelcomeCard";
import { vscode } from "./index";
import type { DashboardData, ExtensionMessage, WebviewMessage } from "./types";

type Tab = "overview" | "trends" | "projects" | "session";

interface AppState {
	activeTab: Tab;
}

export function App() {
	const [activeTab, setActiveTab] = useState<Tab>("overview");
	const [data, setData] = useState<DashboardData | null>(null);
	const [showWelcome, setShowWelcome] = useState(false);

	// Restore tab from saved state on mount
	useEffect(() => {
		const savedState = vscode.getState() as AppState | undefined;
		if (savedState?.activeTab) {
			setActiveTab(savedState.activeTab);
		}
	}, []);

	// Request initial data and listen for updates
	useEffect(() => {
		// Request data from extension
		const requestMessage: WebviewMessage = { type: "requestData" };
		vscode.postMessage(requestMessage);

		// Listen for data updates from extension
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data;
			if (message.type === "usageData") {
				setData(message.payload);
				// Show welcome card if first run
				if (message.payload.isFirstRun) {
					setShowWelcome(true);
				}
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	// Persist tab selection
	const handleTabChange = (tab: Tab) => {
		setActiveTab(tab);
		vscode.setState({ activeTab: tab });
	};

	return (
		<div className="app-container">
			<TrustIndicator />

			{showWelcome && <WelcomeCard onDismiss={() => setShowWelcome(false)} />}

			<nav className="tabs">
				<button
					className={
						activeTab === "overview" ? "tab tab-active" : "tab tab-inactive"
					}
					onClick={() => handleTabChange("overview")}
				>
					Overview
				</button>
				<button
					className={
						activeTab === "trends" ? "tab tab-active" : "tab tab-inactive"
					}
					onClick={() => handleTabChange("trends")}
				>
					Trends
				</button>
				<button
					className={
						activeTab === "projects" ? "tab tab-active" : "tab tab-inactive"
					}
					onClick={() => handleTabChange("projects")}
				>
					Projects
				</button>
				<button
					className={
						activeTab === "session" ? "tab tab-active" : "tab tab-inactive"
					}
					onClick={() => handleTabChange("session")}
				>
					Session
				</button>
			</nav>

			<main className="tab-content">
				{!data ? (
					<div className="loading-skeleton">
						<div className="skeleton-card">
							<div className="skeleton-line skeleton-title"></div>
							<div className="skeleton-line"></div>
							<div className="skeleton-line"></div>
						</div>
						<div className="skeleton-card">
							<div className="skeleton-line skeleton-title"></div>
							<div className="skeleton-line"></div>
						</div>
						<div className="skeleton-card">
							<div className="skeleton-line skeleton-title"></div>
							<div className="skeleton-line"></div>
							<div className="skeleton-line"></div>
						</div>
					</div>
				) : (
					<>
						{activeTab === "overview" && <OverviewTab data={data} />}
						{activeTab === "trends" && <TrendsTab data={data} />}
						{activeTab === "projects" && <ProjectsTab data={data} />}
						{activeTab === "session" && <SessionTab data={data} />}
					</>
				)}
			</main>

			{data && (
				<footer
					style={{
						padding: "8px 0",
						marginTop: "12px",
						borderTop: "1px solid var(--vscode-panel-border)",
						fontSize: "10px",
						opacity: 0.5,
						textAlign: "center",
						wordBreak: "break-all",
					}}
				>
					Data source: {data.dataSourcePath}
				</footer>
			)}
		</div>
	);
}
