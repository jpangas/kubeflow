import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  NamespaceService,
  ActionEvent,
  ConfirmDialogService,
  STATUS_TYPE,
  DIALOG_RESP,
  DialogConfig,
  SnackBarService,
  SnackType,
  ToolbarButton,
  PollerService,
  DashboardState,
} from 'kubeflow';
import { defaultConfig } from './config';
import { environment } from '@app/environment';
import { VWABackendService } from 'src/app/services/backend.service';
import { PVCResponseObject, PVCProcessedObject } from 'src/app/types';
import { Subscription } from 'rxjs';
import { FormDefaultComponent } from '../../form/form-default/form-default.component';
import { Router } from '@angular/router';
import { ActionsService } from 'src/app/services/actions.service';

@Component({
  selector: 'app-index-default',
  templateUrl: './index-default.component.html',
  styleUrls: ['./index-default.component.scss'],
})
export class IndexDefaultComponent implements OnInit, OnDestroy {
  private nsSub = new Subscription();
  private pollSub = new Subscription();

  public env = environment;
  public config = defaultConfig;
  public currNamespace: string | string[];
  public processedData: PVCProcessedObject[] = [];
  public pvcsWaitingViewer = new Set<string>();
  public dashboardDisconnectedState = DashboardState.Disconnected;

  private newVolumeButton = new ToolbarButton({
    text: $localize`New Volume`,
    icon: 'add',
    stroked: true,
    fn: () => {
      this.newResourceClicked();
    },
  });

  buttons: ToolbarButton[] = [this.newVolumeButton];

  constructor(
    public ns: NamespaceService,
    public confirmDialog: ConfirmDialogService,
    public backend: VWABackendService,
    public dialog: MatDialog,
    public snackBar: SnackBarService,
    public poller: PollerService,
    public router: Router,
    public actions: ActionsService,
  ) {}

  ngOnInit() {
    this.nsSub = this.ns.getSelectedNamespace2().subscribe(ns => {
      this.currNamespace = ns;
      this.pvcsWaitingViewer = new Set<string>();
      this.poll(ns);
      this.newVolumeButton.namespaceChanged(ns, $localize`Volume`);
    });
  }

  ngOnDestroy() {
    this.nsSub.unsubscribe();
    this.pollSub.unsubscribe();
  }

  public poll(ns: string | string[]) {
    this.pollSub.unsubscribe();
    this.processedData = [];

    const request = this.backend.getPVCs(ns);

    this.pollSub = this.poller.exponential(request).subscribe(pvcs => {
      this.processedData = this.parseIncomingData(pvcs);
    });
  }

  public reactToAction(a: ActionEvent) {
    switch (a.action) {
      case 'delete':
        this.deleteVolumeClicked(a.data);
        break;
      case 'name:link':
        if (a.data.status.phase === STATUS_TYPE.TERMINATING) {
          this.snackBar.open(
            'PVC is unavailable now.',
            SnackType.Warning,
            3000,
          );
          return;
        }
        this.router.navigate([
          `/volume/details/${a.data.namespace}/${a.data.name}`,
        ]);
        break;
    }
  }

  // Functions for handling the action events
  public newResourceClicked() {
    const ref = this.dialog.open(FormDefaultComponent, {
      width: '600px',
      panelClass: 'form--dialog-padding',
    });

    ref.afterClosed().subscribe(res => {
      if (res === DIALOG_RESP.ACCEPT) {
        this.snackBar.open(
          $localize`Volume was submitted successfully.`,
          SnackType.Success,
          2000,
        );
        this.poll(this.currNamespace);
      }
    });
  }

  public deleteVolumeClicked(pvc: PVCProcessedObject) {
    this.actions.deleteVolume(pvc.name, pvc.namespace).subscribe(result => {
      if (result !== DIALOG_RESP.ACCEPT) {
        return;
      }

      pvc.status.phase = STATUS_TYPE.TERMINATING;
      pvc.status.message = 'Preparing to delete the Volume...';
      pvc.deleteAction = STATUS_TYPE.UNAVAILABLE;
      this.pvcsWaitingViewer.delete(pvc.name);
    });
  }

  // Utility funcs
  public parseIncomingData(pvcs: PVCResponseObject[]): PVCProcessedObject[] {
    const pvcsCopy = JSON.parse(JSON.stringify(pvcs)) as PVCProcessedObject[];

    for (const pvc of pvcsCopy) {
      pvc.deleteAction = this.parseDeletionActionStatus(pvc);
      pvc.ageValue = pvc.age.uptime;
      pvc.ageTooltip = pvc.age.timestamp;
    }

    return pvcsCopy;
  }

  public parseDeletionActionStatus(pvc: PVCProcessedObject) {
    if (pvc.status.phase !== STATUS_TYPE.TERMINATING) {
      return STATUS_TYPE.READY;
    }

    return STATUS_TYPE.TERMINATING;
  }

  public pvcTrackByFn(index: number, pvc: PVCProcessedObject) {
    return `${pvc.name}/${pvc.namespace}/${pvc.capacity}`;
  }
}
