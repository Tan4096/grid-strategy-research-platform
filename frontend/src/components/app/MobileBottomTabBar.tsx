import { MobilePrimaryTab } from "../../types";

interface MobileBottomTabBarProps {
  activeTab: MobilePrimaryTab;
  onTabChange: (tab: MobilePrimaryTab) => void;
  backtestRunning?: boolean;
  optimizeRunning?: boolean;
  liveRunning?: boolean;
}

interface MobileTabItem {
  id: MobilePrimaryTab;
  label: string;
  tourId: string;
}

const MOBILE_TAB_ITEMS: MobileTabItem[] = [
  { id: "params", label: "参数", tourId: "mobile-tab-params" },
  { id: "backtest", label: "回测", tourId: "mobile-tab-backtest" },
  { id: "optimize", label: "优化", tourId: "mobile-tab-optimize" },
  { id: "live", label: "监测", tourId: "mobile-tab-live" }
];

export default function MobileBottomTabBar({
  activeTab,
  onTabChange,
  backtestRunning = false,
  optimizeRunning = false,
  liveRunning = false
}: MobileBottomTabBarProps) {
  const runningByTab: Record<MobilePrimaryTab, boolean> = {
    params: false,
    backtest: backtestRunning,
    optimize: optimizeRunning,
    live: liveRunning
  };

  return (
    <nav className="mobile-bottom-tabbar" aria-label="移动主导航">
      <div className="mobile-bottom-tabbar-inner">
        {MOBILE_TAB_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-bottom-tab-btn ${activeTab === item.id ? "is-active" : ""}`}
            aria-current={activeTab === item.id ? "page" : undefined}
            onClick={() => onTabChange(item.id)}
            data-tour-id={item.tourId}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              {item.label}
              {runningByTab[item.id] && <span className="mobile-bottom-tab-dot" aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
