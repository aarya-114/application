-- Keep room assignment nullable so it can be cleared when a patient is discharged.
-- SQLite allows multiple NULL values while preventing duplicate non-NULL assignments.
CREATE UNIQUE INDEX "Patient_roomId_key" ON "Patient"("roomId");
