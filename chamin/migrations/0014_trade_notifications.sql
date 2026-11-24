CREATE TABLE trade_notification_reads (
  user_id TEXT NOT NULL REFERENCES users(id),
  notification_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,notification_id)
);

-- Rows contain routing metadata only. Commercial information stays in the private workspace.
CREATE VIEW trade_notice_1 (id,company_id,user_id,operations,kind,href,occurred_at) AS
SELECT 'intake:'||e.id,NULL,NULL,1,'enquiry_received','/workspace/bunkers',e.created_at
FROM bunker_enquiries e WHERE e.buyer_company_id IS NULL AND e.declined_at IS NULL
UNION ALL
SELECT 'assignment:'||e.id,e.buyer_company_id,NULL,0,'enquiry_assigned','/workspace/bunkers/'||e.id,e.assigned_at
FROM bunker_enquiries e WHERE e.buyer_company_id IS NOT NULL
UNION ALL
SELECT 'application:'||a.id,NULL,NULL,1,'company_application','/workspace/review',a.submitted_at
FROM company_applications a WHERE a.decision IS NULL;

CREATE VIEW trade_notice_2 (id,company_id,user_id,operations,kind,href,occurred_at) AS
SELECT 'review:'||a.id,a.company_id,NULL,0,
  CASE a.decision WHEN 'approved' THEN 'company_approved' ELSE 'company_correction' END,'/workspace',a.decided_at
FROM company_applications a WHERE a.decision IS NOT NULL
UNION ALL
SELECT 'invite:'||i.enquiry_id||':'||i.supplier_id,i.supplier_id,NULL,0,'supplier_invited','/workspace/bunkers/'||i.enquiry_id,i.invited_at
FROM bunker_invitations i
UNION ALL
SELECT 'quote:'||q.id,CASE WHEN q.kind='counter' THEN q.supplier_id ELSE e.buyer_company_id END,NULL,0,
  CASE WHEN q.kind='counter' THEN 'counter_received' ELSE 'quote_received' END,'/workspace/bunkers/'||q.enquiry_id,q.created_at
FROM bunker_quotes q JOIN bunker_enquiries e ON e.id=q.enquiry_id;

CREATE VIEW trade_notice_3 (id,company_id,user_id,operations,kind,href,occurred_at) AS
SELECT 'request-change:'||x.id||':'||i.supplier_id,i.supplier_id,NULL,0,
  CASE WHEN x.event='cancelled' THEN 'request_cancelled' ELSE 'request_revised' END,
  '/workspace/bunkers/'||x.enquiry_id,x.occurred_at
FROM bunker_request_changes x JOIN bunker_invitations i ON i.enquiry_id=x.enquiry_id AND i.invited_at<=x.occurred_at
UNION ALL
SELECT 'selection:'||o.id,q.supplier_id,NULL,0,'offer_selected','/workspace/bunkers/'||o.enquiry_id,o.selected_at
FROM bunker_orders o JOIN bunker_quotes q ON q.id=o.quote_id
UNION ALL
SELECT 'response:'||o.id,CASE WHEN o.status='withdrawn' THEN q.supplier_id ELSE e.buyer_company_id END,NULL,0,
  'order_'||o.status,'/workspace/bunkers/'||o.enquiry_id,o.responded_at
FROM bunker_orders o JOIN bunker_quotes q ON q.id=o.quote_id JOIN bunker_enquiries e ON e.id=o.enquiry_id
WHERE o.responded_at IS NOT NULL;

CREATE VIEW trade_notice_4 (id,company_id,user_id,operations,kind,href,occurred_at) AS
SELECT 'fulfilment:'||x.order_id||':'||x.revision,
  CASE WHEN u.company_id=e.buyer_company_id THEN q.supplier_id ELSE e.buyer_company_id END,NULL,0,
  'fulfilment_'||x.event,'/workspace/bunkers/'||e.id,x.created_at
FROM bunker_fulfilment_events x JOIN users u ON u.id=x.actor_id
JOIN bunker_orders o ON o.id=x.order_id JOIN bunker_enquiries e ON e.id=o.enquiry_id JOIN bunker_quotes q ON q.id=o.quote_id
UNION ALL
SELECT 'mandate:'||x.id,x.broker_company_id,NULL,0,'broker_assigned','/workspace/bunkers/'||e.id,x.occurred_at
FROM bunker_broker_activity x JOIN bunker_enquiries e ON e.id=x.enquiry_id
JOIN bunker_broker_assignments b ON b.enquiry_id=e.id AND b.broker_company_id=x.broker_company_id AND b.revoked_at IS NULL
JOIN bunker_broker_eligibility p ON p.port_code=e.port_code AND p.company_id=b.broker_company_id
JOIN companies c ON c.id=b.broker_company_id AND c.status='approved'
WHERE x.event='assigned' AND p.revoked_at IS NULL AND p.valid_until>unixepoch()*1000
UNION ALL
SELECT 'fee-issued:'||f.order_id,f.payer_company_id,NULL,0,'fee_issued','/workspace/bunkers/'||o.enquiry_id,f.issued_at
FROM bunker_service_fees f JOIN bunker_orders o ON o.id=f.order_id;

CREATE VIEW trade_notice_5 (id,company_id,user_id,operations,kind,href,occurred_at) AS
SELECT 'fee-reported:'||f.order_id||':'||f.reported_at,NULL,f.issued_by,0,'fee_reported','/workspace/bunkers/'||o.enquiry_id,f.reported_at
FROM bunker_service_fees f JOIN bunker_orders o ON o.id=f.order_id WHERE f.reported_at IS NOT NULL
UNION ALL
SELECT 'fee-received:'||f.order_id,f.payer_company_id,NULL,0,'fee_received','/workspace/bunkers/'||o.enquiry_id,f.received_at
FROM bunker_service_fees f JOIN bunker_orders o ON o.id=f.order_id WHERE f.received_at IS NOT NULL
UNION ALL
SELECT 'ownership:'||t.id,NULL,t.next_owner_id,0,'ownership_requested','/workspace/team',t.created_at
FROM team_transfers t WHERE t.finished_at IS NULL AND t.expires_at>unixepoch()*1000;
