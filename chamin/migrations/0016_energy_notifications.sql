CREATE VIEW trade_notice_6 (id,company_id,user_id,operations,kind,href,occurred_at) AS
SELECT 'energy-owner:'||v.id,e.company_id,NULL,0,'energy_update','/workspace/energy/'||e.id,v.occurred_at
FROM energy_events v JOIN energy_cases e ON e.id=v.case_id
UNION ALL
SELECT 'energy-ops:'||v.id,NULL,NULL,1,'energy_update','/workspace/energy/'||e.id,v.occurred_at
FROM energy_events v JOIN energy_cases e ON e.id=v.case_id
UNION ALL
SELECT 'energy-invite:'||i.case_id||':'||i.company_id,i.company_id,NULL,0,'energy_invitation','/workspace/energy/'||i.case_id,i.invited_at
FROM energy_invitations i
UNION ALL
SELECT 'energy-seller:'||v.id,o.company_id,NULL,0,'energy_update','/workspace/energy/'||e.id,v.occurred_at
FROM energy_events v JOIN energy_cases e ON e.id=v.case_id JOIN energy_offers o ON o.id=e.selected_offer;
