<?php
include_once('/home/decoders/Desktop/openemr/library/sql.inc.php');

$formdata = [
    [
        'pid' => 1,
        'encounter' => 1,
        'activity' => 1,
        'code' => 'J20.9',
        'codetext' => 'Acute bronchitis, unspecified',
        'type_title' => 'Diagnosis',
        'category_title' => 'Assessment',
        'description' => 'Patient presents with cough and fever. Diagnosis: J20.9 Acute bronchitis. Procedure: 99213 Office visit. SNOMED: 195967001 Acute bronchitis disorder.'
    ],
    [
        'pid' => 1,
        'encounter' => 1,
        'activity' => 1,
        'code' => '99213',
        'codetext' => 'Office or other outpatient visit',
        'type_title' => 'Procedure',
        'category_title' => 'Billing',
        'description' => 'Evaluation and management'
    ],
    [
        'pid' => 1,
        'encounter' => 1,
        'activity' => 1,
        'code' => '195967001',
        'codetext' => 'Acute bronchitis',
        'type_title' => 'Problem',
        'category_title' => 'Issue',
        'description' => 'Active medical problem'
    ]
];

// Ensure tables exist or skip if error

foreach ($formdata as $row) {
    $rid = sqlInsert("INSERT INTO form_clinical_notes SET pid = ?, encounter = ?, activity = ?, code = ?, codetext = ?, type_title = ?, category_title = ?, date = NOW(), description = ?",
        [$row['pid'], $row['encounter'], $row['activity'], $row['code'], $row['codetext'], $row['type_title'], $row['category_title'], $row['description']]);
    echo "Inserted clinical note ID: $rid\n";
}
?>
