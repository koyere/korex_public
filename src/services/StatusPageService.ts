import type { HealthMonitor } from '../monitoring/HealthMonitor';
import { createLogger } from '../utils/Logger';

type StatuspageStatus = 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage';

const STATUS_MAP: Record<'healthy' | 'degraded' | 'unhealthy', StatuspageStatus> = {
  healthy:   'operational',
  degraded:  'degraded_performance',
  unhealthy: 'major_outage',
};

export class StatusPageService {
  private readonly logger = createLogger('statuspage');
  private readonly apiKey   = process.env.STATUSPAGE_API_KEY ?? '';
  private readonly pageId   = process.env.STATUSPAGE_PAGE_ID ?? '';
  private readonly compId   = process.env.STATUSPAGE_COMPONENT_ID ?? '';
  private lastStatus: StatuspageStatus | null = null;

  constructor(private readonly healthMonitor: HealthMonitor) {}

  start(): void {
    if (!this.apiKey || !this.pageId || !this.compId) {
      this.logger.warn('Statuspage credentials not configured — skipping integration');
      return;
    }

    this.healthMonitor.on('healthCheck', (health: any) => {
      const overall = health.overall as 'healthy' | 'degraded' | 'unhealthy';
      const next = STATUS_MAP[overall] ?? 'major_outage';
      if (next === this.lastStatus) return;
      this.updateComponent(next).catch((err) =>
        this.logger.error(`Failed to update Statuspage: ${err.message}`)
      );
    });

    this.logger.info('Statuspage integration started');
  }

  private async updateComponent(status: StatuspageStatus): Promise<void> {
    const url = `https://api.statuspage.io/v1/pages/${this.pageId}/components/${this.compId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `OAuth ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ component: { status } }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    this.logger.info(`Statuspage updated: ${this.lastStatus ?? 'none'} → ${status}`);
    this.lastStatus = status;
  }
}
