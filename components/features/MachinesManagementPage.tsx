'use client';

import { MachineCreateImportControls } from '@/components/features/MachineCreateImportControls';
import { MachinesWorkspace } from '@/components/features/MachinesWorkspace';

export function MachinesManagementPage() {
  return (
    <>
      <section className="fleet-workspace">
        <div className="fleet-main-column">
          <section className="fleet-panel">
            <header className="fleet-table-heading">
              <div><span>Machine management</span><h2>Create or import machines</h2></div>
              <div className="fleet-heading-actions">
                <MachineCreateImportControls onChanged={() => window.location.reload()} />
              </div>
            </header>
            <p>Add one machine manually or import many from a validated CSV. Only Asset Name, Client Name, Serial Number and QR Code Number are collected.</p>
          </section>
        </div>
      </section>
      <MachinesWorkspace />
    </>
  );
}
