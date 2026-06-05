DO $seed_demo_jobs$
DECLARE
  v_loc UUID;
  v_set UUID;
  s_scheduled UUID; s_dirt UUID; s_dirt_insp UUID; s_rough UUID; s_rough_insp UUID; s_finish UUID; s_walk UUID; s_complete UUID;
  c_mallory UUID; c_han UUID; c_priya UUID; c_owen UUID; c_renee UUID; c_darius UUID; c_sofia UUID; c_miguel UUID;
  crew_marco UUID; crew_tyrell UUID; crew_ana UUID; crew_victor UUID; crew_lena UUID;
  supply_west UUID; supply_canyon UUID;
  j_scheduled UUID; j_dirt UUID; j_dirt_insp UUID; j_rough UUID; j_rough_insp UUID; j_finish UUID; j_walk UUID; j_complete UUID;
  po_dirt_insp UUID; po_rough_insp UUID;
BEGIN
  SELECT id INTO v_loc FROM public.locations WHERE uptiq_location_id = 'DEMO_LOCATION';
  IF v_loc IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE location_id = v_loc AND address IN ('1842 Cottonwood Lane','77 Stone Ridge Court')) THEN RETURN; END IF;
  SELECT id INTO v_set FROM public.job_state_sets WHERE location_id = v_loc AND is_default LIMIT 1;
  SELECT id INTO s_scheduled FROM public.job_states WHERE state_set_id = v_set AND slug = 'job_scheduled';
  SELECT id INTO s_dirt FROM public.job_states WHERE state_set_id = v_set AND slug = 'dirt_work';
  SELECT id INTO s_dirt_insp FROM public.job_states WHERE state_set_id = v_set AND slug = 'dirt_work_inspection';
  SELECT id INTO s_rough FROM public.job_states WHERE state_set_id = v_set AND slug = 'roughin';
  SELECT id INTO s_rough_insp FROM public.job_states WHERE state_set_id = v_set AND slug = 'roughin_inspection';
  SELECT id INTO s_finish FROM public.job_states WHERE state_set_id = v_set AND slug = 'finish_work';
  SELECT id INTO s_walk FROM public.job_states WHERE state_set_id = v_set AND slug = 'walkthrough';
  SELECT id INTO s_complete FROM public.job_states WHERE state_set_id = v_set AND slug = 'complete';

  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-mallory','Mallory Finch','mallory@example.com','208-555-0101','customer') RETURNING id INTO c_mallory;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-han','Han Lee','han@example.com','208-555-0102','customer') RETURNING id INTO c_han;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-priya','Priya Nair','priya@example.com','208-555-0103','customer') RETURNING id INTO c_priya;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-owen','Owen Brooks','owen@example.com','208-555-0104','customer') RETURNING id INTO c_owen;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-renee','Renee Vargas','renee@example.com','208-555-0105','customer') RETURNING id INTO c_renee;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-darius','Darius King','darius@example.com','208-555-0106','customer') RETURNING id INTO c_darius;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-sofia','Sofia Martinez','sofia@example.com','208-555-0107','customer') RETURNING id INTO c_sofia;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-customer-miguel','Miguel Torres','miguel@example.com','208-555-0108','customer') RETURNING id INTO c_miguel;

  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-crew-marco','Marco Ruiz','marco@example.com','208-555-0201','crew') RETURNING id INTO crew_marco;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-crew-tyrell','Tyrell Boone','tyrell@example.com','208-555-0202','crew') RETURNING id INTO crew_tyrell;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-crew-ana','Ana Price','ana@example.com','208-555-0203','crew') RETURNING id INTO crew_ana;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-crew-victor','Victor Chen','victor@example.com','208-555-0204','crew') RETURNING id INTO crew_victor;
  INSERT INTO public.contacts(location_id, uptiq_contact_id, name, email, phone, role) VALUES (v_loc,'demo-crew-lena','Lena Fox','lena@example.com','208-555-0205','crew') RETURNING id INTO crew_lena;

  INSERT INTO public.supply_house_contacts(location_id, name, rep_name, email, phone) VALUES (v_loc,'West Bench Supply','Cal Pierce','orders@westbench.example.com','208-555-0301') RETURNING id INTO supply_west;
  INSERT INTO public.supply_house_contacts(location_id, name, rep_name, email, phone) VALUES (v_loc,'Canyon Pipe & Fixture','Nora Bell','counter@canyonpipe.example.com','208-555-0302') RETURNING id INTO supply_canyon;

  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_scheduled, '1842 Cottonwood Lane', 0, 5, 0, 0, 0, 0, 12400, current_date + 1, 'Rough-in plumbing for basement finish. Confirm access and material staging before crew dispatch.', 'Homeowner requested text notice before arrival.', NULL) RETURNING id INTO j_scheduled;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_dirt, '77 Stone Ridge Court', 65, 22, 18.5, 418.50, 418.50, 0, 18600, current_date - 4, 'Underground supply and drain relocation for kitchen addition.', 'Crew needs photo of trench before backfill.', NULL) RETURNING id INTO j_dirt;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_dirt_insp, '1220 Juniper Bay Drive', 100, 35, 26, 0, 0, 0, 21400, current_date - 8, 'Underground inspection after sewer lateral repair.', 'Inspector requested cleanout cap visible.', current_date + 1) RETURNING id INTO j_dirt_insp;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_rough, '604 Aspen Hollow Road', 40, 48, 41.25, 762.35, 762.35, 0, 32200, current_date - 12, 'Full rough-in for custom home: two baths, laundry, kitchen, hose bibs.', 'Builder moved laundry wall two inches; confirm before pressure test.', NULL) RETURNING id INTO j_rough;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_rough_insp, '319 Mill Creek Lane', 100, 58, 33.5, 0, 0, 0, 27800, current_date - 10, 'Rough-in inspection for remodel with new powder bath and kitchen island.', 'Office waiting on supply-house invoice for valve package.', current_date) RETURNING id INTO j_rough_insp;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_finish, '901 Red Fox Trail', 72, 78, 59, 529.80, 529.80, 0, 19600, current_date - 20, 'Finish plumbing after countertops: kitchen, master bath, hall bath, laundry sink.', 'Missing brushed nickel tub trim; owner approved alternate.', NULL) RETURNING id INTO j_finish;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_walk, '45 Meadow Run', 100, 94, 67.75, 211.42, 211.42, 0, 24400, current_date - 26, 'Walkthrough after fixture trim. Verify owner punch and water heater startup.', 'Owner wants one escutcheon adjusted before signoff.', NULL) RETURNING id INTO j_walk;
  INSERT INTO public.jobs(location_id, state_set_id, current_state_id, address, state_progress_pct, job_completion_pct, total_hours, total_expenses, total_field_purchase_expenses, total_po_expenses, original_estimate, start_date, scope_of_work, notes, inspection_date)
  VALUES (v_loc, v_set, s_complete, '18 Birch Mesa Place', 100, 100, 74, 0, 0, 0, 28900, current_date - 34, 'Completed finish package awaiting invoice review and payment follow-up.', 'Completion report ready for weekly review.', NULL) RETURNING id INTO j_complete;

  INSERT INTO public.job_customers(job_id, contact_id, is_primary) VALUES
    (j_scheduled,c_mallory,true),(j_dirt,c_han,true),(j_dirt_insp,c_priya,true),(j_rough,c_owen,true),
    (j_rough_insp,c_renee,true),(j_finish,c_darius,true),(j_walk,c_sofia,true),(j_complete,c_miguel,true);

  INSERT INTO public.job_crew(job_id, contact_id, is_lead) VALUES
    (j_scheduled,crew_marco,true),
    (j_dirt,crew_marco,true),(j_dirt,crew_tyrell,false),
    (j_dirt_insp,crew_tyrell,true),
    (j_rough,crew_ana,true),(j_rough,crew_victor,false),
    (j_rough_insp,crew_ana,true),
    (j_finish,crew_lena,true),(j_finish,crew_victor,false),
    (j_walk,crew_lena,true),
    (j_complete,crew_marco,true);

  INSERT INTO public.daily_logs(job_id, crew_contact_id, log_date, state_id, inspection_requested, state_progress_pct, hours_worked, parts_source, parts_list, field_purchase_amount, field_purchase_vendor, field_purchase_description, issues) VALUES
    (j_dirt,crew_marco,current_date-2,s_dirt,false,65,7.5,'field_purchase','Couplings, primer, glue',418.50,'Depot Counter','Emergency fittings for sewer reroute','Waiting for office to confirm backfill photo received.'),
    (j_dirt_insp,crew_tyrell,current_date-1,s_dirt_insp,true,100,2.0,'none',NULL,NULL,NULL,NULL,'Inspection requested for tomorrow morning.'),
    (j_rough,crew_ana,current_date,s_rough,false,40,8.25,'field_purchase','PEX rings and nail plates',762.35,'Depot Counter','Rough-in consumables','Laundry wall shift needs builder confirmation.'),
    (j_rough_insp,crew_ana,current_date-1,s_rough_insp,true,100,3.5,'supply_house','Valve package',NULL,NULL,NULL,'Inspection set for today; office needs final PO value after invoice.'),
    (j_finish,crew_lena,current_date-3,s_finish,false,72,6.0,'field_purchase','Supply lines and trim parts',529.80,'Ferguson Counter','Finish trim parts','Tub trim substitution approved.'),
    (j_walk,crew_lena,current_date,s_walk,false,100,2.75,'none',NULL,NULL,NULL,NULL,'Owner punch has one escutcheon adjustment.'),
    (j_complete,crew_marco,current_date-5,s_complete,false,100,1.0,'none',NULL,NULL,NULL,NULL,'Final photos and completion report submitted.');

  INSERT INTO public.purchase_orders(job_id, supply_house_id, status, estimated_amount, description, created_by_contact_id, sent_at)
  VALUES (j_dirt_insp, supply_west, 'pending_value', 1450, 'Inspection repair fittings and cleanout package', crew_tyrell, now() - interval '1 day') RETURNING id INTO po_dirt_insp;
  INSERT INTO public.purchase_orders(job_id, supply_house_id, status, estimated_amount, description, created_by_contact_id, sent_at)
  VALUES (j_rough_insp, supply_canyon, 'pending_value', 2380, 'Rough-in valve package and fixture boxes', crew_ana, now() - interval '2 days') RETURNING id INTO po_rough_insp;

  INSERT INTO public.job_expenses(job_id, kind, amount, vendor, description, recorded_by_contact_id) VALUES
    (j_dirt,'field_purchase',418.50,'Depot Counter','Emergency fittings for sewer reroute',crew_marco),
    (j_rough,'field_purchase',762.35,'Depot Counter','PEX rings and nail plates',crew_ana),
    (j_finish,'field_purchase',529.80,'Ferguson Counter','Finish trim parts',crew_lena),
    (j_walk,'field_purchase',211.42,'Depot Counter','Escutcheon and trim adjustment parts',crew_lena);

  UPDATE public.jobs SET latest_po = po_dirt_insp WHERE id = j_dirt_insp;
  UPDATE public.jobs SET latest_po = po_rough_insp WHERE id = j_rough_insp;
END
$seed_demo_jobs$;

UPDATE public.app_users SET role = 'owner_admin'
WHERE location_id = (SELECT id FROM public.locations WHERE uptiq_location_id = 'DEMO_LOCATION')
  AND lower(email) = 'dev-admin@uptiq.local';