-- DallmayrERP is now a Machines + Telemetry product. Keep legacy ERP data and
-- routines for history, but remove direct Data API execution from signed-in
-- application users for the retired ERP workflows.

do $$
declare
  sig text;
  retired_functions text[] := array[
    'apply_checklist_template(uuid,uuid)',
    'apply_stock_transaction(uuid,text,integer,text,text,uuid,uuid,text,uuid,text,text)',
    'assign_daily_service_item(text,uuid,uuid,text,integer)',
    'assign_service_job(uuid,uuid)',
    'assign_work_item(uuid,uuid)',
    'close_service_job(uuid,text)',
    'complete_assigned_service_job(uuid,text,text,text,text,text)',
    'consume_work_part(uuid,uuid,integer,text,uuid,text,text)',
    'create_complete_maintenance_plan(jsonb)',
    'create_delivery_order_from_scans(text,text,text,jsonb)',
    'create_direct_message_thread(uuid)',
    'create_group_message_thread(text,uuid[])',
    'create_replenishment_purchase_order(uuid,text)',
    'create_service_call_log(uuid,text,text,text,uuid,uuid,uuid,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,text,text,boolean,boolean,boolean,boolean,text,text,date,date)',
    'create_work_item(text,text,text,text,text,text,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
    'ensure_paid_monthly_service_obligation(uuid,date)',
    'find_historical_service_completion(uuid,date)',
    'generate_due_maintenance_for_machine(uuid)',
    'generate_due_maintenance_work(uuid)',
    'get_finance_workspace_summary(text)',
    'get_inventory_planning_summary(text)',
    'get_marketing_segment_summary(text)',
    'get_operations_manager_report_summary(date,date,text)',
    'get_role_workspace_summary()',
    'get_sales_workspace_summary(text,text)',
    'issue_stock_lot(uuid,uuid,integer,text,text)',
    'issue_stock_serial(uuid,uuid,uuid,uuid,text)',
    'list_assignable_technicians()',
    'list_assignable_users()',
    'list_customer_service_plans(text,text,text,integer)',
    'list_daily_service_schedule(date,text)',
    'list_exception_cases(text,text)',
    'list_exception_comments(uuid)',
    'list_finance_service_coverage(date,text,text)',
    'log_work_time(uuid,text,integer,numeric,text)',
    'receive_purchase_order_line(uuid,integer,uuid,text,text)',
    'receive_stock_lot(uuid,text,integer,text,uuid,date,date,uuid,text)',
    'receive_stock_serial(uuid,text,uuid,uuid,uuid,text)',
    'record_asset_audit(uuid,text,text,text,timestamp with time zone)',
    'record_asset_downtime(uuid,timestamp with time zone,timestamp with time zone,text,text,uuid,uuid)',
    'record_asset_meter_reading(uuid,numeric,text,text,text)',
    'record_customer_service_payment(uuid,date,text,numeric,text,timestamp with time zone,text)',
    'reschedule_daily_service_item(text,uuid,date,text)',
    'resolve_stock_barcode(text)',
    'review_purchase_order(uuid,boolean,text)',
    'review_work_item(uuid,boolean)',
    'save_customer_service_plan(uuid,text,text,numeric,integer,integer,date,date,text)',
    'save_work_completion(uuid,text,text,text,boolean,integer)',
    'search_contract_renewals(text,text,text,text,integer,integer)',
    'search_finance_accounts(text,text,text,text,text,integer,integer,jsonb)',
    'search_finance_accounts(text,text,text,text,text,integer,integer)',
    'search_inventory_recommendations(text,text,text,text,integer,integer)',
    'search_inventory_transfer_suggestions(text,integer,integer)',
    'search_marketing_segments(text,text,text,text,text,text,integer,integer)',
    'search_reliability_machines(text,integer)',
    'search_sales_opportunities(text,text,text,text,integer,integer)',
    'submit_purchase_order_for_approval(uuid)',
    'sync_operational_exceptions()',
    'transition_delivery_order(uuid,text)',
    'transition_purchase_order(uuid,text)',
    'transition_service_job(uuid,text)',
    'transition_work_item(uuid,text)',
    'triage_exception_case(uuid,text,uuid,timestamp with time zone,text)',
    'update_asset_custody(uuid,text,text,text,text)',
    'update_asset_professional_profile(uuid,uuid,text,date,numeric,numeric,integer,date,text)',
    'update_asset_profile(uuid,text,text,date,date,timestamp with time zone)'
  ];
  retired_triggers text[] := array[
    'log_work_item_review_change()',
    'refresh_stock_alert()',
    'sync_monthly_obligation_from_service_job()'
  ];
begin
  foreach sig in array retired_functions || retired_triggers loop
    if to_regprocedure(sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', sig);
    end if;
  end loop;
end $$;
