// Every broker read and trade update checks the current assignment and authority for the requested port.
export const brokerAccess = (enquiry: string) => `EXISTS (
  SELECT 1 FROM bunker_broker_assignments ba JOIN bunker_broker_eligibility be
    ON be.port_code=${enquiry}.port_code AND be.company_id=ba.broker_company_id
  JOIN companies bc ON bc.id=ba.broker_company_id
  WHERE ba.enquiry_id=${enquiry}.id AND ba.broker_company_id=? AND ba.revoked_at IS NULL
    AND be.revoked_at IS NULL AND be.valid_until>? AND bc.status='approved'
)`
