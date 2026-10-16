const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing");
  }

  return createClient(supabaseUrl, supabaseKey);
};

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// GET /api/categories - Fetch all categories
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { data: results, error } = await supabase
      .from('add_category')
      .select('id, name, addedBy')
      .order('id', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }
    
    // Transform data for frontend
    const categories = results.map((item, index) => ({
      id: item.id,
      name: item.name,
      addedBy: item.addedBy,
    }));

    res.json({
      success: true,
      data: categories,
      message: 'Categories fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// POST /api/categories - Add new category
router.post('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { name, username, email } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const currentTime = getCurrentISTForMySQL();

    // Insert into add_category table
    const { error: insertError } = await supabase
      .from('add_category')
      .insert([
        { 
          name: name, 
          addedBy: username || 'system' 
        }
      ]);

    if (insertError) {
      // Handle duplicate category name
      if (insertError.code === '23505') { // PostgreSQL duplicate key error code
        return res.status(400).json({
          success: false,
          message: 'Category name already exists'
        });
      }
      throw new Error(insertError.message);
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: name,
          username: username,
          email: email,
          command: 'Category Added',
          useraction: 'Category Added',
          lastupdate: currentTime
        }
      ]);

    if (logError) {
      console.error('Error logging category addition:', logError);
    }

    res.json({
      success: true,
      message: 'Category added successfully'
    });

  } catch (error) {
    console.error('Error adding category:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error adding category',
      error: error.message
    });
  }
});

// PUT /api/categories/:id - Update category
router.put('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id } = req.params;
    const { name, username, email } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const currentTime = getCurrentISTForMySQL();

    // Get old category name first for audit
    const { data: oldCategory, error: fetchError } = await supabase
      .from('add_category')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchError) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const oldName = oldCategory.name;

    // Update the category
    const { error: updateError } = await supabase
      .from('add_category')
      .update({ 
        name: name, 
        addedBy: username || 'system' 
      })
      .eq('id', id);

    if (updateError) {
      // Handle duplicate category name
      if (updateError.code === '23505') {
        return res.status(400).json({
          success: false,
          message: 'Category name already exists'
        });
      }
      throw new Error(updateError.message);
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: name,
          username: username,
          email: email,
          command: `Updated from ${oldName} to ${name}`,
          useraction: 'Category Updated',
          lastupdate: currentTime
        }
      ]);

    if (logError) {
      console.error('Error logging category update:', logError);
    }

    res.json({
      success: true,
      message: 'Category updated successfully'
    });

  } catch (error) {
    console.error('Error updating category:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error updating category',
      error: error.message
    });
  }
});

// DELETE /api/categories/:id - Delete category
router.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id } = req.params;
    const { reason, username, email } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for deletion'
      });
    }

    // Get category name for audit
    const { data: category, error: fetchError } = await supabase
      .from('add_category')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchError) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const categoryName = category.name;
    const currentTime = getCurrentISTForMySQL();

    // Delete from add_category table
    const { error: deleteError } = await supabase
      .from('add_category')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: categoryName,
          username: username,
          email: email,
          command: reason,
          useraction: 'Category Deleted',
          lastupdate: currentTime
        }
      ]);

    if (logError) {
      console.error('Error logging category deletion:', logError);
    }

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting category',
      error: error.message
    });
  }
});

// -------------------- CHECKLIST ROUTES --------------------

// GET /api/categories/checklists/:categoryName - Fetch checklists for a category
router.get('/checklists/:categoryName', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { categoryName } = req.params;
    
    const { data: results, error } = await supabase
      .from('ChecklistAddition')
      .select('sno, ChecklistCase, Severity, AddedBy, AddedAt')
      .eq('Cat_name', categoryName)
      .order('sno', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data: results,
      message: 'Checklists fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching checklists:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// GET /api/categories/checklists/:categoryName/next-sno - Get next serial number
router.get('/checklists/:categoryName/next-sno', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { categoryName } = req.params;

    const { data: rows, error } = await supabase
      .from('ChecklistAddition')
      .select('sno')
      .eq('Cat_name', categoryName)
      .order('sno', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    const maxSno = rows && rows.length > 0 ? rows[0].sno : 0;
    const nextSno = maxSno + 1;
    
    res.json({
      success: true,
      data: { nextSno },
      message: 'Next serial number fetched successfully'
    });

  } catch (error) {
    console.error('Error getting next serial number:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting next serial number',
      error: error.message
    });
  }
});

// POST /api/categories/checklists - Add new checklist item
router.post('/checklists', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { categoryName, checklistCase, severity, sno, username, email } = req.body;

    if (!categoryName || !checklistCase || !severity || !sno) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const currentTime = getCurrentISTForMySQL();

    // Insert into ChecklistAddition table
    const { error: insertError } = await supabase
      .from('ChecklistAddition')
      .insert([
        {
          sno: sno,
          Cat_name: categoryName,
          ChecklistCase: checklistCase,
          Severity: severity,
          AddedBy: username || 'system',
          AddedAt: currentTime
        }
      ]);

    if (insertError) {
      // Handle duplicate checklist case
      if (insertError.code === '23505') {
        return res.status(400).json({
          success: false,
          message: 'Checklist case already exists for this category'
        });
      }
      throw new Error(insertError.message);
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: checklistCase,
          username: username,
          email: email,
          command: `Added to category: ${categoryName}`,
          useraction: 'Checklist Added',
          lastupdate: currentTime
        }
      ]);

    if (logError) {
      console.error('Error logging checklist addition:', logError);
    }

    res.json({
      success: true,
      message: 'Checklist item added successfully'
    });

  } catch (error) {
    console.error('Error adding checklist:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error adding checklist item',
      error: error.message
    });
  }
});

// PUT /api/categories/checklists/:categoryName - Update checklist item
router.put('/checklists/:categoryName', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { categoryName } = req.params;
    const { oldChecklistCase, checklistCase, severity, username, email } = req.body;

    if (!categoryName || !oldChecklistCase || !checklistCase || !severity) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const currentTime = getCurrentISTForMySQL();

    // Update the checklist item
    const { data: result, error: updateError } = await supabase
      .from('ChecklistAddition')
      .update({
        ChecklistCase: checklistCase,
        Severity: severity,
        AddedBy: username || 'system',
        AddedAt: currentTime
      })
      .eq('ChecklistCase', oldChecklistCase)
      .eq('Cat_name', categoryName)
      .select();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Checklist item not found'
      });
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: checklistCase,
          username: username,
          email: email,
          command: `Updated in category: ${categoryName}`,
          useraction: 'Checklist Updated',
          lastupdate: currentTime
        }
      ]);

    if (logError) {
      console.error('Error logging checklist update:', logError);
    }

    res.json({
      success: true,
      message: 'Checklist item updated successfully'
    });

  } catch (error) {
    console.error('Error updating checklist:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating checklist item',
      error: error.message
    });
  }
});

// DELETE /api/categories/checklists/:categoryName - Delete checklist item
router.delete('/checklists/:categoryName', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { categoryName } = req.params;
    const { checklistCase, reason, username, email } = req.body;

    if (!checklistCase) {
      return res.status(400).json({
        success: false,
        message: 'Checklist case is required'
      });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for deletion'
      });
    }

    const currentTime = getCurrentISTForMySQL();

    // Delete from ChecklistAddition table
    const { data: result, error: deleteError } = await supabase
      .from('ChecklistAddition')
      .delete()
      .eq('ChecklistCase', checklistCase)
      .eq('Cat_name', categoryName)
      .select();

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Checklist item not found'
      });
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: checklistCase,
          username: username,
          email: email,
          command: reason,
          useraction: 'Checklist Addition Deleted',
          lastupdate: currentTime
        }
      ]);

    if (logError) {
      console.error('Error logging checklist deletion:', logError);
    }

    res.json({
      success: true,
      message: 'Checklist item deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting checklist:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting checklist item',
      error: error.message
    });
  }
});

module.exports = router;