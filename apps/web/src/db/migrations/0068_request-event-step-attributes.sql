-- D318: a step's attribute values given before 0067 recorded them are put on the history entry of
-- the action that gave them: the latest action taken at that step, which is the step the request
-- stood at when it was taken (the step its last earlier event moved it to, or the version's first
-- step). Only an entry with no values of its own is filled, so a rerun changes nothing.
WITH taken AS (
  SELECT e.id, e.at, e.request_id, e.attributes,
    coalesce(
      (SELECT p.to_step_id FROM work.request_event p
        WHERE p.request_id = e.request_id AND p.to_step_id IS NOT NULL AND (p.at, p.id) < (e.at, e.id)
        ORDER BY p.at DESC, p.id DESC LIMIT 1),
      (SELECT ts.id FROM work.transition_step ts
        JOIN work.request r ON r.request_type_version_id = ts.request_type_version_id
        WHERE r.id = e.request_id ORDER BY ts.sort_order LIMIT 1)
    ) AS step_id
  FROM work.request_event e
  WHERE e.event_type = 'ActionTaken'
),
latest AS (
  SELECT DISTINCT ON (request_id, step_id) id, at, request_id, step_id, attributes
  FROM taken
  WHERE step_id IS NOT NULL
  ORDER BY request_id, step_id, at DESC, id DESC
),
given AS (
  SELECT l.id, l.at, jsonb_object_agg(a.key, r.attributes -> a.key) AS attributes
  FROM latest l
  JOIN work.request r ON r.id = l.request_id
  JOIN work.attribute_definition a ON a.request_type_version_id = r.request_type_version_id AND a.step_id = l.step_id
  WHERE l.attributes IS NULL AND r.attributes ? a.key
  GROUP BY l.id, l.at
)
UPDATE "work"."request_event" e SET "attributes" = g.attributes
FROM given g
WHERE e.id = g.id AND e.at = g.at;
